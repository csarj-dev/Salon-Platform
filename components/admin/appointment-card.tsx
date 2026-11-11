import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { CancelButton } from "@/components/admin/cancel-button";
import { ValidateButton } from "@/components/admin/validate-button";
import { ResendEmailButton } from "@/components/admin/resend-email-button";
import type { EmailStatusInfo } from "@/lib/email/email-status";
import { formatDateTime, formatPrice, formatTime } from "@/lib/format";
import { buildWhatsAppLink, toWhatsAppNumber } from "@/lib/whatsapp-link";
import { RetryKoiboxButton } from "@/components/admin/retry-koibox-button";
import type { KoiboxCardState } from "@/lib/koibox/card-state";
import { cn } from "@/lib/utils";

// Lo mínimo que necesita la tarjeta: lo cumplen tanto las filas de citas como las de depósitos
export type AppointmentCardData = {
  id: number;
  startsAt: Date;
  status: "booked" | "completed" | "cancelled" | "no_show" | "pending_deposit" | "expired";
  clientName: string;
  clientPhone: string;
  serviceName: string;
  locationName: string;
  staffName: string;
  depositCents: number | null;
  depositDueAt: Date | null;
  // A quién se paga el depósito (solo si en el salón cobra más de una persona)
  collectorLabel?: string | null;
  cancelledAt?: Date | null;
  cancelReason?: string | null;
  cancelledByName?: string | null;
  validatedByName?: string | null;
  // Solo en la lista de citas: la clienta tiene email y cómo fue el último correo
  hasEmail?: boolean;
  email?: EmailStatusInfo | null;
  // Solo con Koibox: su estado allí y el nombre de la cuenta (null = no se enseña nada)
  koibox?: KoiboxCardState | null;
  koiboxAccountLabel?: string | null;
};

type Props = {
  data: AppointmentCardData;
  locale: string;
  zone: string;
  currency: string;
  salonName: string;
  phoneCountryCode: string;
  /** Momento actual en ms, para marcar los plazos que vencen pronto */
  now: number;
  /** Mostrar solo la hora (el día ya está en el encabezado del grupo) */
  timeOnly?: boolean;
  /** Mostrar los botones de gestión (solo en citas futuras o pendientes) */
  actionable: boolean;
  canValidate: boolean;
  canCancel: boolean;
  /** Mostrar "Reenviar correo" */
  canResend?: boolean;
  /** Mostrar "Reintentar" en el estado de Koibox */
  canRetryKoibox?: boolean;
};

const URGENT_MS = 3 * 3_600_000;

const statusClass: Record<AppointmentCardData["status"], string> = {
  booked: "text-foreground",
  completed: "text-muted-foreground",
  no_show: "text-muted-foreground",
  pending_deposit: "border-amber-500 text-amber-700 dark:text-amber-400",
  cancelled: "border-destructive text-destructive",
  expired: "border-destructive text-destructive",
};

export async function AppointmentCard({
  data,
  locale,
  zone,
  currency,
  salonName,
  phoneCountryCode,
  now,
  timeOnly = false,
  actionable,
  canValidate,
  canCancel,
  canResend = false,
  canRetryKoibox = false,
}: Props) {
  const [t, tStatus, tWa, tK] = await Promise.all([
    getTranslations({ locale, namespace: "Admin.card" }),
    getTranslations({ locale, namespace: "Admin.status" }),
    getTranslations({ locale, namespace: "Admin.whatsapp" }),
    getTranslations({ locale, namespace: "Admin.card.koibox" }),
  ]);

  const when = formatDateTime(data.startsAt, locale, zone);
  const waKey =
    data.status === "expired"
      ? "contactExpired"
      : data.status === "pending_deposit"
        ? "contactPending"
        : "contactGeneric";
  const whatsappHref = buildWhatsAppLink(
    toWhatsAppNumber(data.clientPhone, phoneCountryCode),
    tWa(waKey, {
      name: data.clientName,
      salon: salonName,
      id: data.id,
      service: data.serviceName,
      when,
    }),
  );

  const dueSoon =
    data.status === "pending_deposit" &&
    data.depositDueAt !== null &&
    data.depositDueAt.getTime() - now < URGENT_MS;
  const fmt = (d: Date) => formatDateTime(d, locale, zone);

  const k = data.koibox ?? null;
  const workText =
    k?.kind === "pending"
      ? k.work.kind === "push"
        ? tK("work.push")
        : k.work.kind === "cleanup"
          ? tK("work.cleanup")
          : k.work.change.kind === "deposit_paid"
          ? tK("work.depositPaid")
          : k.work.change.kind === "deposit_expired"
            ? tK("work.depositExpired")
            : k.work.change.kind === "moved"
              ? tK("work.moved")
              : tK("work.cancelled")
      : null;

  const showValidate = actionable && canValidate && data.status === "pending_deposit";
  const showCancel =
    actionable &&
    canCancel &&
    (data.status === "pending_deposit" || (data.status === "booked" && data.startsAt.getTime() > now));
  const showResend =
    canResend &&
    data.hasEmail === true &&
    (data.status === "cancelled" || (data.status === "booked" && data.startsAt.getTime() > now));
  const showNoEmail =
    data.hasEmail === false && (data.status === "booked" || data.status === "cancelled");

  return (
    <li className="space-y-2 rounded-lg border p-4">
      {data.email && (
        <p
          className={cn(
            "text-sm",
            data.email.status === "failed" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {data.email.status === "sent" &&
            t("email.sent", { kind: t(`email.kinds.${data.email.kind}`), date: fmt(data.email.at) })}
          {data.email.status === "pending" &&
            t("email.pending", { kind: t(`email.kinds.${data.email.kind}`) })}
          {data.email.status === "failed" &&
            t("email.failed", {
              kind: t(`email.kinds.${data.email.kind}`),
              error: data.email.error ?? "—",
            })}
        </p>
      )}
      {showNoEmail && <p className="text-sm text-muted-foreground">{t("email.none")}</p>}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">
            {timeOnly ? formatTime(data.startsAt, locale, zone) : when} · {data.serviceName}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("with", { staff: data.staffName })} · {data.locationName} · {t("reference", { id: data.id })}
          </p>
        </div>
        <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-xs", statusClass[data.status])}>
          {tStatus(data.status)}
        </span>
      </div>

      <p className="text-sm">
        {data.clientName} · {data.clientPhone}
      </p>

      {data.depositCents !== null && (
        <p className="text-sm text-muted-foreground">
          {t("deposit", { amount: formatPrice(data.depositCents, locale, currency) })}
          {data.collectorLabel ? ` · ${t("collector", { name: data.collectorLabel })}` : ""}
          {data.status === "pending_deposit" && data.depositDueAt && (
            <span className={dueSoon ? "font-medium text-destructive" : undefined}>
              {" · "}
              {t("dueUntil", { date: fmt(data.depositDueAt) })}
              {dueSoon ? ` · ${t("urgent")}` : ""}
            </span>
          )}
          {data.status === "expired" && data.depositDueAt && (
            <span>
              {" · "}
              {t("expiredOn", { date: fmt(data.depositDueAt) })}
            </span>
          )}
        </p>
      )}

      {data.validatedByName && (
        <p className="text-sm text-muted-foreground">{t("validatedBy", { name: data.validatedByName })}</p>
      )}
      {data.status === "cancelled" && data.cancelledAt && (
        <p className="text-sm text-muted-foreground">
          {data.cancelledByName
            ? t("cancelledBy", { name: data.cancelledByName, date: fmt(data.cancelledAt) })
            : t("cancelledNoAuthor", { date: fmt(data.cancelledAt) })}
        </p>
      )}
      {data.cancelReason && (
        <p className="text-sm text-muted-foreground">{t("reason", { reason: data.cancelReason })}</p>
      )}

      {k && (
        <div
          className={cn(
            "space-y-1 rounded-md px-3 py-2 text-sm",
            k.kind === "synced" && "bg-muted/60",
            k.kind === "pending" && "bg-amber-50 dark:bg-amber-950/30",
            k.kind === "missing" && "bg-destructive/10",
          )}
        >
          <p className="font-medium">
            {k.kind === "synced" &&
              (k.cancelled
                ? tK("syncedCancelled", { account: data.koiboxAccountLabel ?? k.account })
                : tK("synced", { account: data.koiboxAccountLabel ?? k.account }))}
            {k.kind === "pending" && tK("pending")}
            {k.kind === "missing" && tK("missing")}
          </p>
          {k.kind === "synced" && k.syncedAt && (
            <p className="text-muted-foreground">{tK("syncedAt", { date: fmt(k.syncedAt) })}</p>
          )}
          {k.kind === "pending" && (
            <>
              <p>{workText}</p>
              {k.lastError && <p className="text-muted-foreground">{tK("lastError", { error: k.lastError })}</p>}
              <p className="text-muted-foreground">{tK("auto")}</p>
            </>
          )}
          {k.kind === "missing" && <p>{tK("missingText")}</p>}
          {canRetryKoibox && k.kind !== "synced" && <RetryKoiboxButton appointmentId={data.id} />}
        </div>
      )}

      <div className="flex flex-wrap items-start gap-2 pt-1">
        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          {t("whatsapp")}
        </a>
        {showValidate && <ValidateButton appointmentId={data.id} />}
        {showResend && <ResendEmailButton appointmentId={data.id} />}
        {showCancel && <CancelButton appointmentId={data.id} />}
      </div>
    </li>
  );
}
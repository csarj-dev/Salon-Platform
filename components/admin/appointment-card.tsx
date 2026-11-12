import { getTranslations } from "next-intl/server";
import { CancelButton } from "@/components/admin/cancel-button";
import { StatusPill, textAction, type Tone } from "@/components/admin/panel-ui";
import { ResendEmailButton } from "@/components/admin/resend-email-button";
import { RetryKoiboxButton } from "@/components/admin/retry-koibox-button";
import { ValidateButton } from "@/components/admin/validate-button";
import type { EmailStatusInfo } from "@/lib/email/email-status";
import { formatDateTime, formatPrice, formatTime } from "@/lib/format";
import type { KoiboxCardState } from "@/lib/koibox/card-state";
import { cn } from "@/lib/utils";
import { buildWhatsAppLink, toWhatsAppNumber } from "@/lib/whatsapp-link";

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
  rescheduledAt?: Date | null;
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

// Color de la pastilla de estado (colores del tema del salón)
const STATUS_TONE: Record<AppointmentCardData["status"], Tone> = {
  booked: "ok",
  pending_deposit: "wait",
  completed: "neutral",
  no_show: "bad",
  cancelled: "bad",
  expired: "bad",
};

// Franja de Koibox: verde = al día, ámbar = le falta algo, rojo = no está
const KOIBOX_TONE = {
  synced: { box: "bg-success/10", dot: "bg-success" },
  pending: { box: "bg-warning/12", dot: "bg-warning" },
  missing: { box: "bg-danger/10", dot: "bg-danger" },
} as const;

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
    <li className="flex flex-col gap-2.5 rounded-xl border bg-card px-4 py-4 sm:px-[1.125rem]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-base font-semibold">
            {timeOnly ? formatTime(data.startsAt, locale, zone) : when} · {data.serviceName}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("with", { staff: data.staffName })} · {data.locationName} · {t("reference", { id: data.id })}
          </p>
        </div>
        <StatusPill tone={STATUS_TONE[data.status]}>{tStatus(data.status)}</StatusPill>
      </div>

      <p className="text-sm">
        <span className="font-medium">{data.clientName}</span>{" "}
        <span className="text-muted-foreground">· {data.clientPhone}</span>
      </p>

      {/* Líneas de detalle; si no hay ninguna, el bloque no ocupa sitio (empty:hidden) */}
      <div className="space-y-0.5 text-sm text-muted-foreground empty:hidden">
        {data.depositCents !== null && (
          <p>
            {t("deposit", { amount: formatPrice(data.depositCents, locale, currency) })}
            {data.collectorLabel ? ` · ${t("collector", { name: data.collectorLabel })}` : ""}
            {data.status === "pending_deposit" && data.depositDueAt && (
              <span className={dueSoon ? "font-medium text-danger" : undefined}>
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
        {data.validatedByName && <p>{t("validatedBy", { name: data.validatedByName })}</p>}
        {data.rescheduledAt && <p>{t("rescheduledAt", { date: fmt(data.rescheduledAt) })}</p>}
        {data.status === "cancelled" && data.cancelledAt && (
          <p>
            {data.cancelledByName
              ? t("cancelledBy", { name: data.cancelledByName, date: fmt(data.cancelledAt) })
              : t("cancelledNoAuthor", { date: fmt(data.cancelledAt) })}
          </p>
        )}
        {data.cancelReason && <p>{t("reason", { reason: data.cancelReason })}</p>}
        {data.email && (
          <p className={data.email.status === "failed" ? "text-danger" : undefined}>
            {data.email.status === "sent" &&
              t("email.sent", { kind: t(`email.kinds.${data.email.kind}`), date: fmt(data.email.at) })}
            {data.email.status === "pending" && t("email.pending", { kind: t(`email.kinds.${data.email.kind}`) })}
            {data.email.status === "failed" &&
              t("email.failed", { kind: t(`email.kinds.${data.email.kind}`), error: data.email.error ?? "—" })}
          </p>
        )}
        {showNoEmail && <p>{t("email.none")}</p>}
      </div>

      {k && (
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm",
            KOIBOX_TONE[k.kind].box,
          )}
        >
          <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-0.5">
            <p className="inline-flex items-center gap-2 font-medium">
              <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", KOIBOX_TONE[k.kind].dot)} />
              {k.kind === "synced" && (k.cancelled ? tK("syncedCancelled") : tK("synced"))}
              {k.kind === "pending" && tK("pending")}
              {k.kind === "missing" && tK("missing")}
            </p>
            {k.kind === "synced" && (
              <p className="text-muted-foreground">
                {data.koiboxAccountLabel ?? k.account}
                {k.syncedAt ? ` · ${tK("syncedAt", { date: fmt(k.syncedAt) })}` : ""}
              </p>
            )}
            {k.kind === "pending" && <p className="text-muted-foreground">{workText}</p>}
            {k.kind === "pending" && k.lastError && (
              <p className="text-danger">{tK("lastError", { error: k.lastError })}</p>
            )}
            {k.kind === "missing" && <p className="text-muted-foreground">{tK("missingText")}</p>}
          </div>
          {canRetryKoibox && k.kind !== "synced" && <RetryKoiboxButton appointmentId={data.id} />}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 pt-1">
        {showValidate && <ValidateButton appointmentId={data.id} />}
        <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className={textAction()}>
          {t("whatsapp")}
        </a>
        {showResend && <ResendEmailButton appointmentId={data.id} />}
        {showCancel && <CancelButton appointmentId={data.id} />}
      </div>
    </li>
  );
}
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import type { EmailStatusInfo } from "@/lib/email/email-status";
import type { KoiboxCardState } from "@/lib/koibox/card-state";
import { KOIBOX_TONE } from "@/components/admin/appointment-marks";
import { CancelButton } from "@/components/admin/cancel-button";
import { textAction } from "@/components/admin/panel-ui";
import { ResendEmailButton } from "@/components/admin/resend-email-button";
import { RetryKoiboxButton } from "@/components/admin/retry-koibox-button";
import { ValidateButton } from "@/components/admin/validate-button";
import { formatDateTime, formatPrice } from "@/lib/format";
import { koiboxWorkKey } from "@/lib/koibox/card-state";
import { cn } from "@/lib/utils";
import { buildWhatsAppLink, toWhatsAppNumber } from "@/lib/whatsapp-link";
import { Link } from "@/i18n/navigation";

export type AppointmentDetailData = {
  id: number;
  clientId?: number; // para "Ver todas sus citas"
  startsAt: Date;
  status: "booked" | "completed" | "cancelled" | "no_show" | "pending_deposit" | "expired";
  clientName: string;
  clientPhone: string;
  clientEmail?: string | null;
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
  data: AppointmentDetailData;
  locale: string;
  zone: string;
  currency: string;
  salonName: string;
  phoneCountryCode: string;
  /** Momento actual en ms, para marcar los plazos que vencen pronto */
  now: number;
  /** Mostrar los botones de gestión (solo en citas futuras o pendientes) */
  actionable: boolean;
  canValidate: boolean;
  canCancel: boolean;
  canResend?: boolean;
  canRetryKoibox?: boolean;
  /**
   * "columns": clienta / depósito y correo / Koibox en columnas (desplegable de la tabla).
   * "stack": todo en una columna, sin títulos (tarjeta; y el panel lateral de la agenda).
   */
  layout?: "columns" | "stack";
};

const URGENT_MS = 3 * 3_600_000;
const sectionLabel = "text-xs font-medium tracking-[0.06em] text-muted-foreground uppercase";

// La ficha de una cita: lo que se sabe de ella y lo que se puede hacer.
// No sabe dónde está: la usan la tabla de Citas, la tarjeta de Depósitos y (más adelante) la agenda.
export async function AppointmentDetail({
  data,
  locale,
  zone,
  currency,
  salonName,
  phoneCountryCode,
  now,
  actionable,
  canValidate,
  canCancel,
  canResend = false,
  canRetryKoibox = false,
  layout = "stack",
}: Props) {
  const [t, tWa, tK] = await Promise.all([
    getTranslations({ locale, namespace: "Admin.card" }),
    getTranslations({ locale, namespace: "Admin.whatsapp" }),
    getTranslations({ locale, namespace: "Admin.card.koibox" }),
  ]);

  const fmt = (d: Date) => formatDateTime(d, locale, zone);
  const waKey =
    data.status === "expired" ? "contactExpired" : data.status === "pending_deposit" ? "contactPending" : "contactGeneric";
  const whatsappHref = buildWhatsAppLink(
    toWhatsAppNumber(data.clientPhone, phoneCountryCode),
    tWa(waKey, { name: data.clientName, salon: salonName, id: data.id, service: data.serviceName, when: fmt(data.startsAt) }),
  );

  const dueSoon =
    data.status === "pending_deposit" && data.depositDueAt !== null && data.depositDueAt.getTime() - now < URGENT_MS;
  const showValidate = actionable && canValidate && data.status === "pending_deposit";
  const showCancel =
    actionable &&
    canCancel &&
    (data.status === "pending_deposit" || (data.status === "booked" && data.startsAt.getTime() > now));
  const showResend =
    canResend &&
    data.hasEmail === true &&
    (data.status === "cancelled" || (data.status === "booked" && data.startsAt.getTime() > now));
  const showNoEmail = data.hasEmail === false && (data.status === "booked" || data.status === "cancelled");

  // Líneas de detalle: depósito, quién validó, cambios, cancelación, correo
  const lines: ReactNode[] = [];
  if (data.depositCents !== null) {
    lines.push(
      <p key="deposit">
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
      </p>,
    );
  }
  if (data.validatedByName) lines.push(<p key="validated">{t("validatedBy", { name: data.validatedByName })}</p>);
  if (data.rescheduledAt) lines.push(<p key="moved">{t("rescheduledAt", { date: fmt(data.rescheduledAt) })}</p>);
  if (data.status === "cancelled" && data.cancelledAt) {
    lines.push(
      <p key="cancelled">
        {data.cancelledByName
          ? t("cancelledBy", { name: data.cancelledByName, date: fmt(data.cancelledAt) })
          : t("cancelledNoAuthor", { date: fmt(data.cancelledAt) })}
      </p>,
    );
  }
  if (data.cancelReason) lines.push(<p key="reason">{t("reason", { reason: data.cancelReason })}</p>);
  if (data.email) {
    const kind = t(`email.kinds.${data.email.kind}`);
    lines.push(
      <p key="email" className={data.email.status === "failed" ? "text-danger" : undefined}>
        {data.email.status === "sent" && t("email.sent", { kind, date: fmt(data.email.at) })}
        {data.email.status === "pending" && t("email.pending", { kind })}
        {data.email.status === "failed" && t("email.failed", { kind, error: data.email.error ?? "—" })}
      </p>,
    );
  }
  if (showNoEmail) lines.push(<p key="noEmail">{t("email.none")}</p>);

  const k = data.koibox ?? null;
  const koiboxStrip = k && (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm", KOIBOX_TONE[k.kind].box)}>
      <div className="flex min-w-0 flex-[1_1_14rem] flex-col gap-0.5">
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
        {k.kind === "pending" && <p className="text-muted-foreground">{tK(`work.${koiboxWorkKey(k.work)}`)}</p>}
        {k.kind === "pending" && k.lastError && <p className="text-danger">{tK("lastError", { error: k.lastError })}</p>}
        {k.kind === "missing" && <p className="text-muted-foreground">{tK("missingText")}</p>}
      </div>
      {canRetryKoibox && k.kind !== "synced" && <RetryKoiboxButton appointmentId={data.id} />}
    </div>
  );

  const actions = (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
      {showValidate && <ValidateButton appointmentId={data.id} />}
      <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className={textAction()}>
        {t("whatsapp")}
      </a>
      {showResend && <ResendEmailButton appointmentId={data.id} />}
      {showCancel && <CancelButton appointmentId={data.id} />}
    </div>
  );

  if (layout === "columns") {
    return (
      <div className="flex flex-col gap-4">
        <div className={cn("grid gap-4", k ? "md:grid-cols-3" : "md:grid-cols-2")}>
          <section className="space-y-1 text-sm">
            <h3 className={sectionLabel}>{t("client")}</h3>
            <p className="font-medium">{data.clientName}</p>
            {data.clientId !== undefined && (
              <Link href={`/admin/appointments?client=${data.clientId}`} className={cn(textAction(), "min-h-9")}>
                {t("allClientAppointments")}
              </Link>
            )}
            <p className="text-muted-foreground">
              {data.clientPhone}
              {data.clientEmail ? ` · ${data.clientEmail}` : ""}
            </p>
          </section>
          <section className="space-y-1 text-sm">
            <h3 className={sectionLabel}>{t("depositAndEmail")}</h3>
            <div className="space-y-0.5 text-muted-foreground">
              {lines.length > 0 ? lines : <p>{t("nothingMore")}</p>}
            </div>
          </section>
          {koiboxStrip}
        </div>
        <div className="border-t pt-2">{actions}</div>
      </div>
    );
  }

  return (
    <>
      {lines.length > 0 && <div className="space-y-0.5 text-sm text-muted-foreground">{lines}</div>}
      {koiboxStrip}
      <div className="pt-1">{actions}</div>
    </>
  );
}
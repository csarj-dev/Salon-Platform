import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { CancelButton } from "@/components/admin/cancel-button";
import { ValidateButton } from "@/components/admin/validate-button";
import { formatDateTime, formatPrice, formatTime } from "@/lib/format";
import { buildWhatsAppLink, toWhatsAppNumber } from "@/lib/whatsapp-link";
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
  cancelledAt?: Date | null;
  cancelReason?: string | null;
  cancelledByName?: string | null;
  validatedByName?: string | null;
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
}: Props) {
  const [t, tStatus, tWa] = await Promise.all([
    getTranslations({ locale, namespace: "Admin.card" }),
    getTranslations({ locale, namespace: "Admin.status" }),
    getTranslations({ locale, namespace: "Admin.whatsapp" }),
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

  const showValidate = actionable && canValidate && data.status === "pending_deposit";
  const showCancel =
    actionable &&
    canCancel &&
    (data.status === "pending_deposit" || (data.status === "booked" && data.startsAt.getTime() > now));

  return (
    <li className="space-y-2 rounded-lg border p-4">
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
        {showCancel && <CancelButton appointmentId={data.id} />}
      </div>
    </li>
  );
}
import { getTranslations } from "next-intl/server";
import { AppointmentDetail } from "@/components/admin/appointment-detail";
import { STATUS_TONE } from "@/components/admin/appointment-marks";
import { StatusPill } from "@/components/admin/panel-ui";
import type { EmailStatusInfo } from "@/lib/email/email-status";
import { formatDateTime, formatTime } from "@/lib/format";
import type { KoiboxCardState } from "@/lib/koibox/card-state";

// Lo mínimo que necesita una cita para pintarse: lo cumplen las filas de citas y las de depósitos
export type AppointmentCardData = {
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

// Una cita como tarjeta (Depósitos): cabecera + su ficha en una columna
export async function AppointmentCard({ timeOnly = false, ...props }: Props) {
  const { data, locale, zone } = props;
  const [t, tStatus] = await Promise.all([
    getTranslations({ locale, namespace: "Admin.card" }),
    getTranslations({ locale, namespace: "Admin.status" }),
  ]);

  return (
    <li className="flex flex-col gap-2.5 rounded-xl border bg-card px-4 py-4 sm:px-[1.125rem]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-base font-semibold">
            {timeOnly ? formatTime(data.startsAt, locale, zone) : formatDateTime(data.startsAt, locale, zone)} ·{" "}
            {data.serviceName}
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

      <AppointmentDetail {...props} layout="stack" />
    </li>
  );
}
// Qué se manda a Koibox por cada reserva web y por cada cambio posterior.
// Lógica pura: sin red ni base de datos. Quien llama (lib/koibox-sync.ts) hace las peticiones.
import { DateTime } from "luxon";
import { formatPrice } from "../format";
import { KOIBOX_STATUS, WEB_TAG, buildAppointmentNotes, freesSlot, withWebTag } from "./statuses";
import { refId, type KoiboxAppointment, type KoiboxAppointmentInput, type KoiboxAppointmentPatch } from "./types";

// Una cita de nuestra base, ya con sus ids de Koibox resueltos
export type WebBooking = {
  ref: number; // nuestro id de cita
  serviceName: string;
  startsAt: Date;
  endsAt: Date;
  zone: string; // zona horaria del salón: Koibox guarda fecha y hora locales
  koiboxUserId: number;
  koiboxClientId: number;
  koiboxServiceId: number;
  clientName: string;
  clientEmail: string | null;
  // Depósito pendiente de pago, si lo lleva. `collector`: a quién se paga (solo si cobra más de una)
  deposit: { cents: number; currency: string; dueAt: Date; collector?: string | null } | null;
};

// Primera línea de las notas: con ella se reconoce una cita nuestra en Koibox
export const webRefLine = (ref: number) => `Reserva web #${ref}`;

export function toKoiboxAppointment(b: WebBooking): KoiboxAppointmentInput {
  const start = DateTime.fromJSDate(b.startsAt, { zone: b.zone });
  const end = DateTime.fromJSDate(b.endsAt, { zone: b.zone });
  const lines: string[] = [];
  if (b.deposit) {
    const due = DateTime.fromJSDate(b.deposit.dueAt, { zone: b.zone }).toFormat("dd/MM HH:mm");
    const to = b.deposit.collector ? ` (cobra ${b.deposit.collector})` : "";
    lines.push(`Depósito ${formatPrice(b.deposit.cents, "es-ES", b.deposit.currency)}${to} pendiente de pago hasta el ${due}`);
  }
  return {
    titulo: b.serviceName,
    fecha: start.toFormat("yyyy-MM-dd"),
    hora_inicio: start.toFormat("HH:mm:ss"),
    hora_fin: end.toFormat("HH:mm:ss"),
    user: b.koiboxUserId,
    cliente: b.koiboxClientId,
    servicios: [b.koiboxServiceId],
    // "Pendiente" es el estado normal de una cita que aún no ha llegado
    estado: KOIBOX_STATUS.PENDING,
    notas: buildAppointmentNotes({ ref: b.ref, clientName: b.clientName, clientEmail: b.clientEmail, lines }),
    tags: b.deposit ? [{ name: WEB_TAG.PAYMENT_PENDING }] : [],
  };
}

// Cosas que le pasan a la cita en nuestra web después de reservarla
export type WebChange =
  | { kind: "deposit_paid" }
  | { kind: "deposit_expired" } // venció el plazo sin pagar
  | { kind: "cancelled_by_client" }
  | { kind: "cancelled_by_staff"; reason?: string | null }
  // Cambio de hora: esta se anula y se crea otra en Koibox (con la misma referencia web,
  // porque en nuestra base sigue siendo la misma cita)
  | { kind: "moved"; startsAt: Date; zone: string };

// El PATCH que toca en Koibox, mirando cómo está ahora la cita allí.
// null = no hay nada que cambiar (p. ej. ya estaba anulada: así repetir no hace daño).
export function koiboxPatchFor(change: WebChange, current: KoiboxAppointment): KoiboxAppointmentPatch | null {
  const alreadyFree = freesSlot(refId(current.estado));
  const addNote = (line: string) => [current.notas?.trim(), line].filter(Boolean).join("\n");

  switch (change.kind) {
    case "deposit_paid":
      if (alreadyFree) return null;
      return { tags: withWebTag(current.tags, WEB_TAG.DEPOSIT_PAID) };
    case "deposit_expired":
      if (alreadyFree) return null;
      return { estado: KOIBOX_STATUS.CANCELLED, notas: addNote("Anulada: no se pagó el depósito a tiempo") };
    case "cancelled_by_client":
      if (alreadyFree) return null;
      return { estado: KOIBOX_STATUS.CANCELLED_BY_CLIENT, notas: addNote("Anulada por la clienta desde la web") };
    case "cancelled_by_staff": {
      if (alreadyFree) return null;
      const reason = change.reason?.replace(/\s+/g, " ").trim();
      return {
        estado: KOIBOX_STATUS.CANCELLED,
        notas: addNote(reason ? `Anulada desde el panel: ${reason}` : "Anulada desde el panel"),
      };
    }
    case "moved":
      if (alreadyFree) return null;
      return {
        estado: KOIBOX_STATUS.CANCELLED,
        notas: addNote(
          `Cambiada de hora desde la web al ${DateTime.fromJSDate(change.startsAt, { zone: change.zone }).toFormat("dd/MM HH:mm")}`,
        ),
      };
  }
}

// Busca entre las citas de Koibox la que creamos para nuestra cita `ref` (por la primera
// línea de las notas). Sirve para no duplicarla al reintentar. Las anuladas no cuentan.
export function findWebAppointment(list: KoiboxAppointment[], ref: number): KoiboxAppointment | null {
  const line = webRefLine(ref);
  return (
    list.find((a) => !freesSlot(refId(a.estado)) && (a.notas ?? "").split("\n")[0].trim() === line) ?? null
  );
}
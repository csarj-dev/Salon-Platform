// Qué le falta a una cita para que Koibox quede igual que nuestra base.
// Se deduce del estado de la cita, no de una lista de tareas: así da igual quién hizo el cambio
// (la web, el panel, un script) o si falló antes. Lógica pura: sin red ni base de datos.
import type { WebChange } from "./booking";

export type KoiboxSyncRow = {
  status: "booked" | "completed" | "cancelled" | "no_show" | "pending_deposit" | "expired";
  startsAt: Date;
  koiboxAppointmentId: number | null;
  koiboxError: string | null;
  koiboxSyncedAt: Date | null; // última vez que se llevó algo a Koibox con éxito
  cancelledAt: Date | null;
  cancelledBy: string | null; // usuario del equipo; vacío = la clienta (o un script)
  cancelReason: string | null;
  depositDueAt: Date | null;
  depositPaidAt: Date | null;
  koiboxPreviousId: number | null; // cambio de hora: la cita de la hora anterior, sin anular aún
};

export type KoiboxWork =
  | { kind: "push" }
  | { kind: "change"; change: WebChange }
  | { kind: "cleanup"; koiboxAppointmentId: number }; // anular la de la hora anterior

export function koiboxWorkFor(r: KoiboxSyncRow, now: Date): KoiboxWork | null {
  // Primero lo que dejó a medias un cambio de hora: hay dos citas en Koibox y una sobra
  if (r.koiboxPreviousId !== null) return { kind: "cleanup", koiboxAppointmentId: r.koiboxPreviousId };

  const linked = r.koiboxAppointmentId !== null;
  // ¿Pasó `t` después de la última vez que se sincronizó con Koibox?
  const notSyncedSince = (t: Date | null) =>
    t !== null && (r.koiboxSyncedAt === null || r.koiboxSyncedAt.getTime() < t.getTime());

  switch (r.status) {
    case "booked":
    case "pending_deposit":
      // Se intentó apuntar y falló (o no se sabe si llegó): reintentar mientras no haya pasado
      if (!linked) return r.koiboxError !== null && r.startsAt.getTime() > now.getTime() ? { kind: "push" } : null;
      if (r.status === "booked" && notSyncedSince(r.depositPaidAt)) return { kind: "change", change: { kind: "deposit_paid" } };
      return null;
    case "expired":
      return linked && notSyncedSince(r.depositDueAt) ? { kind: "change", change: { kind: "deposit_expired" } } : null;
    case "cancelled":
      if (!linked || !notSyncedSince(r.cancelledAt)) return null;
      return {
        kind: "change",
        change: r.cancelledBy ? { kind: "cancelled_by_staff", reason: r.cancelReason } : { kind: "cancelled_by_client" },
      };
    default:
      return null;
  }
}
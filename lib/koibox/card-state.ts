// Qué se enseña de Koibox en la tarjeta de una cita. Lógica pura: usa la misma regla
// que el reintento automático (koiboxWorkFor), así la tarjeta y el cron nunca discrepan.
import { koiboxWorkFor, type KoiboxSyncRow, type KoiboxWork } from "./pending";

export type KoiboxCardRow = KoiboxSyncRow & { koiboxAccount: string | null };

export type KoiboxCardState =
  // Está en Koibox y no le falta nada (también si está anulada allí)
  | { kind: "synced"; account: string; syncedAt: Date | null; cancelled: boolean }
  // Le falta algo: apuntarla, marcar el depósito, anularla...
  | { kind: "pending"; work: KoiboxWork; lastError: string | null }
  // Cita activa que nunca se apuntó en Koibox y no tiene error (p. ej. de antes de conectar Koibox)
  | { kind: "missing" };

export function koiboxCardState(r: KoiboxCardRow, now: Date): KoiboxCardState | null {
  const work = koiboxWorkFor(r, now);
  if (work) return { kind: "pending", work, lastError: r.koiboxError };

  if (r.koiboxAppointmentId !== null && r.koiboxAccount) {
    return {
      kind: "synced",
      account: r.koiboxAccount,
      syncedAt: r.koiboxSyncedAt,
      cancelled: r.status === "cancelled" || r.status === "expired",
    };
  }
  const active = r.status === "booked" || r.status === "pending_deposit";
  if (active && r.startsAt.getTime() > now.getTime()) return { kind: "missing" };
  // Pasada, o cancelada sin haber llegado a Koibox: no hay nada que enseñar
  return null;
}

export type KoiboxWorkKey = "push" | "cleanup" | "depositPaid" | "depositExpired" | "moved" | "cancelled";

// Qué texto explica lo que le falta a una cita en Koibox (Admin.card.koibox.work.*)
export function koiboxWorkKey(work: KoiboxWork): KoiboxWorkKey {
  if (work.kind === "push") return "push";
  if (work.kind === "cleanup") return "cleanup";
  switch (work.change.kind) {
    case "deposit_paid":
      return "depositPaid";
    case "deposit_expired":
      return "depositExpired";
    case "moved":
      return "moved";
    default:
      return "cancelled";
  }
}
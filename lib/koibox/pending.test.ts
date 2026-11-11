import { describe, expect, it } from "vitest";
import { koiboxWorkFor, type KoiboxSyncRow } from "./pending";

const NOW = new Date("2026-11-04T10:00:00Z");
const h = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000);

const row = (patch: Partial<KoiboxSyncRow> = {}): KoiboxSyncRow => ({
  status: "booked",
  startsAt: h(48),
  koiboxAppointmentId: 900,
  koiboxError: null,
  koiboxSyncedAt: h(-5),
  cancelledAt: null,
  cancelledBy: null,
  cancelReason: null,
  depositDueAt: null,
  depositPaidAt: null,
  koiboxPreviousId: null,
  ...patch,
});

describe("koiboxWorkFor", () => {
  it("una cita al día no necesita nada", () => {
    expect(koiboxWorkFor(row(), NOW)).toBeNull();
  });

  it("sin apuntar y con error: reintentar, solo si aún no ha pasado", () => {
    const failed = row({ koiboxAppointmentId: null, koiboxError: "Koibox no responde", koiboxSyncedAt: null });
    expect(koiboxWorkFor(failed, NOW)).toEqual({ kind: "push" });
    expect(koiboxWorkFor({ ...failed, status: "pending_deposit" }, NOW)).toEqual({ kind: "push" });
    expect(koiboxWorkFor({ ...failed, startsAt: h(-1) }, NOW)).toBeNull();
  });

  it("sin apuntar y sin error: es de antes de usar Koibox (o del modo local), no se toca", () => {
    expect(koiboxWorkFor(row({ koiboxAppointmentId: null, koiboxSyncedAt: null }), NOW)).toBeNull();
  });

  it("depósito pagado después de la última sincronización: cambiar la etiqueta", () => {
    expect(koiboxWorkFor(row({ depositPaidAt: h(-1) }), NOW)).toEqual({ kind: "change", change: { kind: "deposit_paid" } });
    expect(koiboxWorkFor(row({ depositPaidAt: h(-6) }), NOW)).toBeNull(); // ya se llevó
  });

  it("depósito vencido: anular en Koibox una vez", () => {
    const expired = row({ status: "expired", depositDueAt: h(-1) });
    expect(koiboxWorkFor(expired, NOW)).toEqual({ kind: "change", change: { kind: "deposit_expired" } });
    expect(koiboxWorkFor({ ...expired, koiboxSyncedAt: h(-0.5) }, NOW)).toBeNull();
    expect(koiboxWorkFor({ ...expired, koiboxAppointmentId: null }, NOW)).toBeNull();
  });

  it("cancelada: por el equipo (con motivo) o por la clienta", () => {
    const byStaff = row({ status: "cancelled", cancelledAt: h(-1), cancelledBy: "user-1", cancelReason: "Enferma" });
    expect(koiboxWorkFor(byStaff, NOW)).toEqual({
      kind: "change",
      change: { kind: "cancelled_by_staff", reason: "Enferma" },
    });
    expect(koiboxWorkFor({ ...byStaff, cancelledBy: null }, NOW)).toEqual({
      kind: "change",
      change: { kind: "cancelled_by_client" },
    });
    expect(koiboxWorkFor({ ...byStaff, koiboxSyncedAt: h(-0.5) }, NOW)).toBeNull();
  });

  it("anulada porque Koibox no la aceptó: nunca llegó allí, nada que hacer", () => {
    const rejected = row({ status: "cancelled", cancelledAt: h(-1), koiboxAppointmentId: null, koiboxError: "400" });
    expect(koiboxWorkFor(rejected, NOW)).toBeNull();
  });

  it("realizadas y no presentadas las lleva recepción en Koibox", () => {
    expect(koiboxWorkFor(row({ status: "completed", koiboxSyncedAt: null }), NOW)).toBeNull();
    expect(koiboxWorkFor(row({ status: "no_show", koiboxSyncedAt: null }), NOW)).toBeNull();
  });

  it("un cambio de hora a medias: primero anular la de antes", () => {
    expect(koiboxWorkFor(row({ koiboxPreviousId: 700 }), NOW)).toEqual({ kind: "cleanup", koiboxAppointmentId: 700 });
  });
});
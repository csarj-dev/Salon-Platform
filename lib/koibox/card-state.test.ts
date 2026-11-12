import { describe, expect, it } from "vitest";
import { koiboxCardState, koiboxWorkKey, type KoiboxCardRow } from "./card-state";

const now = new Date("2026-11-10T12:00:00Z");
const future = new Date("2026-11-12T10:00:00Z");
const past = new Date("2026-11-08T10:00:00Z");

const row = (over: Partial<KoiboxCardRow> = {}): KoiboxCardRow => ({
  status: "booked",
  startsAt: future,
  koiboxAccount: "salon",
  koiboxAppointmentId: 900,
  koiboxError: null,
  koiboxSyncedAt: new Date("2026-11-10T11:00:00Z"),
  cancelledAt: null,
  cancelledBy: null,
  cancelReason: null,
  depositDueAt: null,
  depositPaidAt: null,
  koiboxPreviousId: null,
  ...over,
});

describe("koiboxCardState", () => {
  it("en Koibox y al día", () => {
    expect(koiboxCardState(row(), now)).toEqual({
      kind: "synced",
      account: "salon",
      syncedAt: new Date("2026-11-10T11:00:00Z"),
      cancelled: false,
    });
  });

  it("anulada allí y aquí: al día, marcada como anulada", () => {
    const r = row({ status: "cancelled", cancelledAt: new Date("2026-11-10T10:00:00Z") });
    expect(koiboxCardState(r, now)).toMatchObject({ kind: "synced", cancelled: true });
  });

  it("falló al apuntarla: pendiente con el error", () => {
    const r = row({ koiboxAccount: null, koiboxAppointmentId: null, koiboxSyncedAt: null, koiboxError: "network: sin respuesta" });
    expect(koiboxCardState(r, now)).toEqual({ kind: "pending", work: { kind: "push" }, lastError: "network: sin respuesta" });
  });

  it("depósito validado después de la última vez que se sincronizó", () => {
    const r = row({ depositPaidAt: new Date("2026-11-10T11:30:00Z") });
    expect(koiboxCardState(r, now)).toMatchObject({ kind: "pending", work: { kind: "change", change: { kind: "deposit_paid" } } });
  });

  it("cancelada aquí y aún no allí", () => {
    const r = row({ status: "cancelled", cancelledAt: new Date("2026-11-10T11:30:00Z"), cancelledBy: "u1", cancelReason: "Enferma" });
    expect(koiboxCardState(r, now)).toMatchObject({
      kind: "pending",
      work: { kind: "change", change: { kind: "cancelled_by_staff", reason: "Enferma" } },
    });
  });

  it("activa, futura y nunca apuntada: no está en Koibox", () => {
    const r = row({ koiboxAccount: null, koiboxAppointmentId: null, koiboxSyncedAt: null });
    expect(koiboxCardState(r, now)).toEqual({ kind: "missing" });
  });

  it("pasada y nunca apuntada: no se enseña nada", () => {
    const r = row({ startsAt: past, koiboxAccount: null, koiboxAppointmentId: null, koiboxSyncedAt: null });
    expect(koiboxCardState(r, now)).toBeNull();
  });
});

describe("koiboxWorkKey", () => {
  it("da la clave del texto de cada trabajo pendiente", () => {
    expect(koiboxWorkKey({ kind: "push" })).toBe("push");
    expect(koiboxWorkKey({ kind: "cleanup", koiboxAppointmentId: 1 })).toBe("cleanup");
    expect(koiboxWorkKey({ kind: "change", change: { kind: "deposit_paid" } })).toBe("depositPaid");
    expect(koiboxWorkKey({ kind: "change", change: { kind: "deposit_expired" } })).toBe("depositExpired");
    expect(koiboxWorkKey({ kind: "change", change: { kind: "cancelled_by_client" } })).toBe("cancelled");
  });
});
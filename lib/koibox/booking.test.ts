import { describe, expect, it } from "vitest";
import { findWebAppointment, koiboxPatchFor, toKoiboxAppointment, type WebBooking } from "./booking";
import { KOIBOX_STATUS, WEB_TAG } from "./statuses";
import type { KoiboxAppointment } from "./types";

const ZONE = "Atlantic/Canary";

const booking: WebBooking = {
  ref: 42,
  serviceName: "Laminado de cejas",
  // 10:30 en Canarias (noviembre: UTC+0)
  startsAt: new Date("2026-11-05T10:30:00Z"),
  endsAt: new Date("2026-11-05T11:30:00Z"),
  zone: ZONE,
  koiboxUserId: 101,
  koiboxClientId: 7,
  koiboxServiceId: 111,
  clientName: "Laura Gómez",
  clientEmail: "laura@example.com",
  deposit: null,
};

const inKoibox = (patch: Partial<KoiboxAppointment> = {}): KoiboxAppointment => ({
  id: 900,
  titulo: "Laminado de cejas",
  fecha: "2026-11-05",
  hora_inicio: "10:30:00",
  hora_fin: "11:30:00",
  user: 101,
  estado: KOIBOX_STATUS.PENDING,
  notas: "Reserva web #42\nClienta: Laura Gómez",
  tags: [{ id: 1, name: "VIP" }, { id: 2, name: WEB_TAG.PAYMENT_PENDING }],
  ...patch,
});

describe("toKoiboxAppointment", () => {
  it("cita pendiente con hora local del salón, clienta, servicio y notas", () => {
    expect(toKoiboxAppointment(booking)).toEqual({
      titulo: "Laminado de cejas",
      fecha: "2026-11-05",
      hora_inicio: "10:30:00",
      hora_fin: "11:30:00",
      user: 101,
      cliente: 7,
      servicios: [111],
      estado: KOIBOX_STATUS.PENDING,
      notas: "Reserva web #42\nClienta: Laura Gómez\nCorreo: laura@example.com",
      tags: [],
    });
  });

  it("usa la hora de Canarias también en horario de verano", () => {
    const summer = { ...booking, startsAt: new Date("2026-07-01T09:00:00Z"), endsAt: new Date("2026-07-01T10:00:00Z") };
    expect(toKoiboxAppointment(summer)).toMatchObject({ fecha: "2026-07-01", hora_inicio: "10:00:00", hora_fin: "11:00:00" });
  });

  it("con depósito: etiqueta de pago pendiente y una línea con importe y plazo", () => {
    const r = toKoiboxAppointment({
      ...booking,
      clientEmail: null,
      deposit: { cents: 1500, currency: "EUR", dueAt: new Date("2026-11-04T18:00:00Z") },
    });
    expect(r.tags).toEqual([{ name: WEB_TAG.PAYMENT_PENDING }]);
    expect(r.notas?.split("\n")).toEqual([
      "Reserva web #42",
      "Clienta: Laura Gómez",
      // Intl pone un espacio duro antes del €; al limpiar las notas queda como espacio normal
      "Depósito 15,00 € pendiente de pago hasta el 04/11 18:00",
    ]);
  });
});

describe("toKoiboxAppointment · cobrador", () => {
  it("si se indica, dice a quién se paga el depósito", () => {
    const r = toKoiboxAppointment({
      ...booking,
      deposit: { cents: 1500, currency: "EUR", dueAt: new Date("2026-11-04T18:00:00Z"), collector: "Amanda" },
    });
    expect(r.notas?.split("\n").at(-1)).toBe("Depósito 15,00 € (cobra Amanda) pendiente de pago hasta el 04/11 18:00");
  });
});

describe("koiboxPatchFor", () => {
  it("depósito pagado: cambia la etiqueta de la web y conserva las del salón", () => {
    expect(koiboxPatchFor({ kind: "deposit_paid" }, inKoibox())).toEqual({
      tags: [{ name: "VIP" }, { name: WEB_TAG.DEPOSIT_PAID }],
    });
  });

  it("depósito vencido: anulada, con el motivo en las notas", () => {
    expect(koiboxPatchFor({ kind: "deposit_expired" }, inKoibox())).toEqual({
      estado: KOIBOX_STATUS.CANCELLED,
      notas: "Reserva web #42\nClienta: Laura Gómez\nAnulada: no se pagó el depósito a tiempo",
    });
  });

  it("cancelada por la clienta: 'anulada por el usuario'", () => {
    expect(koiboxPatchFor({ kind: "cancelled_by_client" }, inKoibox())).toMatchObject({
      estado: KOIBOX_STATUS.CANCELLED_BY_CLIENT,
    });
  });

  it("cancelada por el equipo: anulada, con el motivo si lo hay", () => {
    expect(koiboxPatchFor({ kind: "cancelled_by_staff", reason: "  Enferma\n" }, inKoibox({ notas: null })))
      .toEqual({ estado: KOIBOX_STATUS.CANCELLED, notas: "Anulada desde el panel: Enferma" });
    expect(koiboxPatchFor({ kind: "cancelled_by_staff" }, inKoibox({ notas: "" }))?.notas).toBe("Anulada desde el panel");
  });

  it("cambio de hora: anula esta y apunta la hora nueva", () => {
    const moved = { kind: "moved" as const, startsAt: new Date("2026-11-06T16:00:00Z"), zone: ZONE };
    const patch = koiboxPatchFor(moved, inKoibox());
    expect(patch?.estado).toBe(KOIBOX_STATUS.CANCELLED);
    expect(patch?.notas).toMatch(/\nCambiada de hora desde la web al 06\/11 16:00$/);
  });

  it("si ya está anulada en Koibox, no se toca (repetir no hace daño)", () => {
    for (const estado of [KOIBOX_STATUS.CANCELLED, KOIBOX_STATUS.CANCELLED_BY_CLIENT, { value: KOIBOX_STATUS.DELETED }]) {
      const current = inKoibox({ estado });
      expect(koiboxPatchFor({ kind: "deposit_expired" }, current)).toBeNull();
      expect(koiboxPatchFor({ kind: "cancelled_by_client" }, current)).toBeNull();
      expect(koiboxPatchFor({ kind: "deposit_paid" }, current)).toBeNull();
    }
  });
});

describe("findWebAppointment", () => {
  it("encuentra la nuestra por la primera línea de las notas, sin confundir #42 con #420", () => {
    const ours = inKoibox({ id: 1 });
    const other = inKoibox({ id: 2, notas: "Reserva web #420\nClienta: Otra" });
    const byPhone = inKoibox({ id: 3, notas: "Llamó por teléfono. Reserva web #42 no" });
    expect(findWebAppointment([other, byPhone, ours], 42)?.id).toBe(1);
    expect(findWebAppointment([other, byPhone], 42)).toBeNull();
  });

  it("ignora las anuladas (p. ej. la de antes de un cambio de hora)", () => {
    const old = inKoibox({ id: 1, estado: KOIBOX_STATUS.CANCELLED });
    const current = inKoibox({ id: 2 });
    expect(findWebAppointment([old, current], 42)?.id).toBe(2);
    expect(findWebAppointment([old], 42)).toBeNull();
  });
});
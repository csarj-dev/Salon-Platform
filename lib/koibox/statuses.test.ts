import { describe, expect, it } from "vitest";
import { KOIBOX_STATUS, WEB_TAG, buildAppointmentNotes, freesSlot, withWebTag } from "./statuses";

describe("freesSlot", () => {
  it("las anuladas y eliminadas liberan el hueco; el resto no", () => {
    expect(freesSlot(KOIBOX_STATUS.CANCELLED)).toBe(true);
    expect(freesSlot(KOIBOX_STATUS.CANCELLED_BY_CLIENT)).toBe(true);
    expect(freesSlot(KOIBOX_STATUS.DELETED)).toBe(true);
    expect(freesSlot(KOIBOX_STATUS.PENDING)).toBe(false);
    expect(freesSlot(KOIBOX_STATUS.COMPLETED)).toBe(false);
    expect(freesSlot(KOIBOX_STATUS.NO_SHOW)).toBe(false);
    expect(freesSlot(null)).toBe(false);
  });
});

describe("withWebTag", () => {
  it("cambia la etiqueta de la web y conserva las del salón", () => {
    const current = [{ id: 1, name: "VIP" }, { id: 2, name: WEB_TAG.PAYMENT_PENDING }];
    expect(withWebTag(current, WEB_TAG.DEPOSIT_PAID)).toEqual([{ name: "VIP" }, { name: WEB_TAG.DEPOSIT_PAID }]);
  });

  it("funciona sin etiquetas previas", () => {
    expect(withWebTag(undefined, WEB_TAG.PAID_IN_FULL)).toEqual([{ name: WEB_TAG.PAID_IN_FULL }]);
  });
});

describe("buildAppointmentNotes", () => {
  it("una línea por dato, sin líneas vacías", () => {
    expect(
      buildAppointmentNotes({
        ref: 42,
        clientName: "Marta Ruiz",
        clientEmail: "marta@ejemplo.com",
        lines: ["  Depósito 10,00 €   ref. B2M9Q1 ", "   "],
      }),
    ).toBe("Reserva web #42\nClienta: Marta Ruiz\nCorreo: marta@ejemplo.com\nDepósito 10,00 € ref. B2M9Q1");
  });

  it("sin correo no pone la línea", () => {
    expect(buildAppointmentNotes({ ref: 1, clientName: "Ana" })).toBe("Reserva web #1\nClienta: Ana");
  });
});
import { describe, it, expect } from "vitest";
import { getAvailableSlots } from "./availability";

// 2 de noviembre de 2026: en Canarias es hora de invierno (UTC+0)
const at = (hhmm: string) => new Date(`2026-11-02T${hhmm}:00Z`);
const shift = (from: string, to: string) => ({ start: at(from), end: at(to) });
const hhmm = (slots: Date[]) => slots.map((d) => d.toISOString().slice(11, 16));

const base = {
  durationMin: 60,
  stepMin: 30,
  bufferMin: 0,
  now: new Date("2026-10-01T00:00:00Z"),
  minNoticeHours: 0,
};

describe("getAvailableSlots", () => {
  it("devuelve todos los huecos de un turno sin citas", () => {
    const slots = getAvailableSlots({
      ...base,
      workingHours: [shift("10:00", "12:00")],
      busy: [],
    });
    expect(hhmm(slots)).toEqual(["10:00", "10:30", "11:00"]);
  });

  it("respeta una cita en medio del turno", () => {
    const slots = getAvailableSlots({
      ...base,
      workingHours: [shift("10:00", "14:00")],
      busy: [shift("11:00", "12:00")],
    });
    expect(hhmm(slots)).toEqual(["10:00", "12:00", "12:30", "13:00"]);
  });

  it("no ofrece huecos que se pasen del cierre", () => {
    const slots = getAvailableSlots({
      ...base,
      durationMin: 75,
      workingHours: [shift("10:00", "12:00")],
      busy: [],
    });
    expect(hhmm(slots)).toEqual(["10:00", "10:30"]);
  });

  it("trata cada turno de un turno partido por separado", () => {
    const slots = getAvailableSlots({
      ...base,
      workingHours: [shift("10:00", "11:00"), shift("16:00", "17:00")],
      busy: [],
    });
    expect(hhmm(slots)).toEqual(["10:00", "16:00"]);
  });

  it("aplica el margen antes y después de una cita", () => {
    const slots = getAvailableSlots({
      ...base,
      bufferMin: 15,
      workingHours: [shift("10:00", "14:00")],
      busy: [shift("11:00", "12:00")],
    });
    // Ocupado efectivo: 10:45-12:15. Antes no cabe una hora; después, desde 12:30.
    expect(hhmm(slots)).toEqual(["12:30", "13:00"]);
  });

  it("deja margen también antes de la siguiente cita", () => {
    const slots = getAvailableSlots({
      ...base,
      bufferMin: 15,
      workingHours: [shift("10:00", "14:00")],
      busy: [shift("12:00", "13:00")],
    });
    // Ocupado efectivo: 11:45-13:15. El de 11:00 acabaría a las 12:00 (sin margen): fuera.
    // Tras la cita, 13:30 + 60 min pasa del cierre: fuera.
    expect(hhmm(slots)).toEqual(["10:00", "10:30"]);
  });

  it("no pide margen al llegar al cierre del turno", () => {
    const slots = getAvailableSlots({
      ...base,
      bufferMin: 15,
      workingHours: [shift("10:00", "12:00")],
      busy: [],
    });
    expect(hhmm(slots)).toEqual(["10:00", "10:30", "11:00"]);
  });

  it("descarta lo que empieza antes de la antelación mínima", () => {
    const slots = getAvailableSlots({
      ...base,
      now: at("09:00"),
      minNoticeHours: 2,
      workingHours: [shift("10:00", "13:00")],
      busy: [],
    });
    expect(hhmm(slots)).toEqual(["11:00", "11:30", "12:00"]);
  });
});
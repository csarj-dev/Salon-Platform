import { describe, expect, it } from "vitest";
import { checkSlot } from "./slot-check";

const t = (hhmm: string) => new Date(`2026-11-02T${hhmm}:00Z`);
const iv = (from: string, to: string) => ({ start: t(from), end: t(to) });

const base = {
  shifts: [iv("09:00", "14:00")],
  timeOff: [],
  blocks: [],
  koiboxBusy: [],
  appointments: [],
};

describe("checkSlot", () => {
  it("dentro del turno y sin nada: libre y sin avisos", () => {
    expect(checkSlot({ ...base, slot: iv("10:00", "11:00") })).toEqual({ clash: null, warnings: [] });
  });

  it("se pisa con una cita nuestra: choque con esa cita", () => {
    const carmen = { id: 7, clientName: "Carmen Vidal", startsAt: t("10:00"), endsAt: t("11:20") };
    const r = checkSlot({ ...base, appointments: [carmen], slot: iv("11:00", "12:00") });
    expect(r.clash).toEqual({ kind: "appointment", appointment: carmen });
  });

  it("una justo después de otra no se pisa", () => {
    const carmen = { id: 7, clientName: "Carmen Vidal", startsAt: t("10:00"), endsAt: t("11:00") };
    expect(checkSlot({ ...base, appointments: [carmen], slot: iv("11:00", "12:00") }).clash).toBeNull();
  });

  it("una cita que solo está en Koibox también choca", () => {
    const r = checkSlot({ ...base, koiboxBusy: [iv("12:00", "13:00")], slot: iv("12:30", "13:00") });
    expect(r.clash).toEqual({ kind: "koibox", startsAt: t("12:00"), endsAt: t("13:00") });
  });

  it("al mover, la hora de antes no choca consigo misma en Koibox", () => {
    const before = iv("10:00", "11:00");
    expect(checkSlot({ ...base, koiboxBusy: [before], ignore: before, slot: iv("10:30", "11:30") }).clash).toBeNull();
  });

  it("si choca con una nuestra, se dice esa (aunque también esté en Koibox)", () => {
    const carmen = { id: 7, clientName: "Carmen Vidal", startsAt: t("10:00"), endsAt: t("11:00") };
    const r = checkSlot({ ...base, appointments: [carmen], koiboxBusy: [iv("10:00", "11:00")], slot: iv("10:30", "11:00") });
    expect(r.clash?.kind).toBe("appointment");
  });

  it("se sale del turno: aviso", () => {
    expect(checkSlot({ ...base, slot: iv("13:30", "14:30") }).warnings).toEqual(["outside_shift"]);
  });

  it("dos turnos seguidos cuentan como uno; con hueco entre medias, no", () => {
    const joined = [iv("09:00", "12:00"), iv("12:00", "14:00")];
    expect(checkSlot({ ...base, shifts: joined, slot: iv("11:30", "12:30") }).warnings).toEqual([]);
    const split = [iv("09:00", "12:00"), iv("13:00", "14:00")];
    expect(checkSlot({ ...base, shifts: split, slot: iv("11:30", "12:30") }).warnings).toEqual(["outside_shift"]);
  });

  it("sin turno ese día: fuera de turno", () => {
    expect(checkSlot({ ...base, shifts: [], slot: iv("10:00", "11:00") }).warnings).toEqual(["outside_shift"]);
  });

  it("en una ausencia o un bloqueo: avisos", () => {
    const r = checkSlot({ ...base, timeOff: [iv("10:00", "10:30")], blocks: [iv("10:45", "11:15")], slot: iv("10:00", "11:00") });
    expect(r.warnings).toEqual(["time_off", "block"]);
  });
});
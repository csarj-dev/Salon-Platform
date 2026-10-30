import { describe, expect, it } from "vitest";
import { blockOccursOn, busyOn, shiftsOn, workingHoursOn, type KoiboxSnapshot } from "./schedule";
import type { KoiboxSchedule } from "./types";

const ZONE = "Atlantic/Canary"; // en noviembre, UTC+0

const day = (from: string, to: string) => ({ hora_inicio: from, hora_fin: to });
const usual = (user: number, extra: Partial<KoiboxSchedule> = {}): KoiboxSchedule => ({
  id: user,
  user,
  centro: 1,
  week: null,
  year: null,
  lunes: day("09:00:00", "14:00:00"),
  martes: day("09:00:00", "14:00:00"),
  miercoles: null,
  jueves: [day("16:00:00", "20:00:00"), day("09:00:00", "13:00:00")], // turno partido, desordenado
  viernes: day("09:00:00", "14:00:00"),
  sabado: null,
  domingo: null,
  ...extra,
});

// Lunes 2, miércoles 4 y jueves 5 de noviembre de 2026 (semana ISO 45)
const MON = "2026-11-02";
const WED = "2026-11-04";
const THU = "2026-11-05";

describe("shiftsOn", () => {
  it("usa el horario de siempre según el día de la semana", () => {
    const s = [usual(7)];
    expect(shiftsOn(s, 7, MON)).toEqual([{ start: "09:00:00", end: "14:00:00" }]);
    expect(shiftsOn(s, 7, WED)).toEqual([]);
  });

  it("admite turno partido y lo ordena", () => {
    expect(shiftsOn([usual(7)], 7, THU)).toEqual([
      { start: "09:00:00", end: "13:00:00" },
      { start: "16:00:00", end: "20:00:00" },
    ]);
  });

  it("el horario de esa semana manda sobre el de siempre", () => {
    const override = usual(7, { id: 99, week: "45", year: "2026", lunes: day("15:00:00", "19:00:00") });
    expect(shiftsOn([usual(7), override], 7, MON)).toEqual([{ start: "15:00:00", end: "19:00:00" }]);
    // La semana siguiente vuelve el de siempre
    expect(shiftsOn([usual(7), override], 7, "2026-11-09")).toEqual([{ start: "09:00:00", end: "14:00:00" }]);
  });

  it("sin horario no trabaja, y no mezcla profesionales", () => {
    expect(shiftsOn([usual(7)], 8, MON)).toEqual([]);
    expect(shiftsOn([], 7, MON)).toEqual([]);
  });

  it("ignora tramos vacíos o al revés", () => {
    expect(shiftsOn([usual(7, { lunes: day("14:00:00", "09:00:00") })], 7, MON)).toEqual([]);
  });
});

describe("blockOccursOn", () => {
  const block = (recurrence: string) => ({ date: "2026-11-02", recurrence });

  it("sin repetición, solo ese día", () => {
    expect(blockOccursOn(block("none"), "2026-11-02")).toBe(true);
    expect(blockOccursOn(block("none"), "2026-11-03")).toBe(false);
  });

  it("nunca antes de su fecha", () => {
    for (const r of ["none", "day_1___", "week_1___", "week_2___", "month_1___"]) {
      expect(blockOccursOn(block(r), "2026-11-01")).toBe(false);
    }
  });

  it("cada día, cada semana, cada dos semanas y cada mes", () => {
    expect(blockOccursOn(block("day_1___"), "2026-11-20")).toBe(true);
    expect(blockOccursOn(block("week_1___"), "2026-11-09")).toBe(true);
    expect(blockOccursOn(block("week_1___"), "2026-11-10")).toBe(false);
    expect(blockOccursOn(block("week_2___"), "2026-11-09")).toBe(false);
    expect(blockOccursOn(block("week_2___"), "2026-11-16")).toBe(true);
    expect(blockOccursOn(block("month_1___"), "2026-12-02")).toBe(true);
    expect(blockOccursOn(block("month_1___"), "2026-12-03")).toBe(false);
  });

  it("una repetición desconocida cuenta solo ese día", () => {
    expect(blockOccursOn(block("year_1___"), "2026-11-02")).toBe(true);
    expect(blockOccursOn(block("year_1___"), "2027-11-02")).toBe(false);
  });
});

describe("workingHoursOn y busyOn", () => {
  const snapshot: KoiboxSnapshot = {
    schedules: [usual(7)],
    appointments: [
      { userId: 7, date: MON, start: "10:00:00", end: "11:00:00" },
      { userId: 8, date: MON, start: "09:00:00", end: "10:00:00" }, // otra profesional
      { userId: 7, date: "2026-11-03", start: "09:00:00", end: "10:00:00" }, // otro día
    ],
    blocks: [{ userId: 7, date: "2026-10-26", start: "12:00:00", end: "12:30:00", recurrence: "week_1___" }],
  };

  it("pasa los turnos a instantes reales en la zona del salón", () => {
    expect(workingHoursOn(snapshot, 7, MON, ZONE)).toEqual([
      { start: new Date("2026-11-02T09:00:00Z"), end: new Date("2026-11-02T14:00:00Z") },
    ]);
  });

  it("junta las citas y los bloqueos de ese día y de esa profesional", () => {
    expect(busyOn(snapshot, 7, MON, ZONE)).toEqual([
      { start: new Date("2026-11-02T10:00:00Z"), end: new Date("2026-11-02T11:00:00Z") },
      { start: new Date("2026-11-02T12:00:00Z"), end: new Date("2026-11-02T12:30:00Z") },
    ]);
  });
});
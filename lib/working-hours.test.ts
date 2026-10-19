import { describe, it, expect } from "vitest";
import { buildWorkingHours, dayRange } from "./working-hours";

const ZONE = "Atlantic/Canary";
const iso = (ivs: { start: Date; end: Date }[]) =>
  ivs.map((i) => [i.start.toISOString().slice(11, 16), i.end.toISOString().slice(11, 16)]);

// weekday: 1 = lunes ... 7 = domingo
const rows = [
  { weekday: 1, startTime: "16:00:00", endTime: "20:00:00" },
  { weekday: 1, startTime: "10:00:00", endTime: "14:00:00" },
  { weekday: 3, startTime: "12:00:00", endTime: "20:00:00" },
];

describe("buildWorkingHours", () => {
  it("devuelve los dos turnos de un lunes, ordenados", () => {
    // lunes 2 de noviembre de 2026: hora de invierno, UTC+0
    const r = buildWorkingHours("2026-11-02", ZONE, rows);
    expect(iso(r)).toEqual([["10:00", "14:00"], ["16:00", "20:00"]]);
  });

  it("devuelve vacío en un día sin turnos", () => {
    // martes 3 de noviembre
    expect(buildWorkingHours("2026-11-03", ZONE, rows)).toEqual([]);
  });

  it("aplica el desfase de verano: lunes 19 de octubre es UTC+1", () => {
    const r = buildWorkingHours("2026-10-19", ZONE, rows);
    expect(iso(r)).toEqual([["09:00", "13:00"], ["15:00", "19:00"]]);
  });
});

describe("dayRange", () => {
  it("un día normal dura 24 horas", () => {
    const { start, end } = dayRange("2026-11-02", ZONE);
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(24);
  });

  it("el día del cambio de hora de octubre dura 25 horas", () => {
    const { start, end } = dayRange("2026-10-25", ZONE);
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(25);
  });
});
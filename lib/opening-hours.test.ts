import { describe, it, expect } from "vitest";
import { formatOpeningHours, groupOpeningHours, type HoursRow } from "./opening-hours";

const row = (weekday: number, openTime: string, closeTime: string): HoursRow => ({
  weekday, openTime, closeTime,
});

const weekdays = [1, 2, 3, 4, 5].map((d) => row(d, "09:00:00", "19:30:00"));

describe("groupOpeningHours", () => {
  it("junta los días contiguos con el mismo horario", () => {
    const g = groupOpeningHours([...weekdays, row(6, "09:00:00", "17:00:00")]);
    expect(g).toEqual([
      { from: 1, to: 5, shifts: [["09:00", "19:30"]] },
      { from: 6, to: 6, shifts: [["09:00", "17:00"]] },
      { from: 7, to: 7, shifts: [] }, // domingo sin filas = cerrado
    ]);
  });

  it("conserva los turnos partidos, ordenados aunque lleguen desordenados", () => {
    const g = groupOpeningHours([
      row(1, "16:00:00", "20:00:00"),
      row(1, "10:00:00", "14:00:00"),
    ]);
    expect(g[0].shifts).toEqual([["10:00", "14:00"], ["16:00", "20:00"]]);
  });

  it("no junta dos días iguales separados por uno distinto", () => {
    const g = groupOpeningHours([
      row(1, "09:00:00", "14:00:00"),
      row(2, "10:00:00", "14:00:00"),
      row(3, "09:00:00", "14:00:00"),
    ]);
    expect(g.slice(0, 3).map((x) => [x.from, x.to])).toEqual([[1, 1], [2, 2], [3, 3]]);
  });

  it("sin ninguna fila, toda la semana es un único grupo cerrado", () => {
    expect(groupOpeningHours([])).toEqual([{ from: 1, to: 7, shifts: [] }]);
  });
});

describe("formatOpeningHours", () => {
  const groups = groupOpeningHours([
    ...[1, 2, 3, 4, 5].flatMap((d) => [row(d, "10:00:00", "14:00:00"), row(d, "16:00:00", "20:00:00")]),
    row(6, "10:00:00", "14:00:00"),
  ]);

  it("da el texto en español", () => {
    expect(formatOpeningHours(groups, "es")).toEqual([
      { days: "Lun–Vie", hours: "10:00–14:00 · 16:00–20:00" },
      { days: "Sáb", hours: "10:00–14:00" },
      { days: "Dom", hours: null },
    ]);
  });

  it("da el texto en inglés", () => {
    expect(formatOpeningHours(groups, "en").map((l) => l.days)).toEqual(["Mon–Fri", "Sat", "Sun"]);
  });
});
import { describe, expect, it } from "vitest";
import { groupByDay } from "./group-by-day";

const at = (iso: string) => ({ startsAt: new Date(iso) });

describe("groupByDay", () => {
  it("agrupa por día respetando el orden", () => {
    const groups = groupByDay(
      [at("2026-11-02T10:00:00Z"), at("2026-11-02T12:00:00Z"), at("2026-11-03T09:00:00Z")],
      "Atlantic/Canary",
    );
    expect(groups.map((g) => [g.day, g.rows.length])).toEqual([
      ["2026-11-02", 2],
      ["2026-11-03", 1],
    ]);
  });

  it("usa la zona del salón: las 23:30 UTC de verano ya son el día siguiente en Madrid", () => {
    const groups = groupByDay([at("2026-07-01T23:30:00Z")], "Europe/Madrid");
    expect(groups[0].day).toBe("2026-07-02");
  });

  it("sin filas no hay grupos", () => {
    expect(groupByDay([], "Atlantic/Canary")).toEqual([]);
  });
});
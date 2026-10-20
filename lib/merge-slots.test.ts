import { describe, it, expect } from "vitest";
import { mergeSlots } from "./merge-slots";

const at = (hhmm: string) => new Date(`2026-11-02T${hhmm}:00Z`);

describe("mergeSlots", () => {
  it("une los huecos y dice qué profesionales hay en cada hora", () => {
    const merged = mergeSlots([
      { staffId: 1, staffName: "Ana", slots: [at("11:00"), at("11:30")] },
      { staffId: 2, staffName: "Lucía", slots: [at("10:30"), at("11:00")] },
    ]);

    expect(merged.map((m) => m.startsAt.toISOString().slice(11, 16))).toEqual([
      "10:30",
      "11:00",
      "11:30",
    ]);
    expect(merged[0].staffIds).toEqual([2]);
    expect(merged[1].staffIds).toEqual([1, 2]);
    expect(merged[2].staffIds).toEqual([1]);
  });

  it("devuelve una lista vacía si nadie tiene huecos", () => {
    expect(mergeSlots([])).toEqual([]);
    expect(mergeSlots([{ staffId: 1, staffName: "Ana", slots: [] }])).toEqual([]);
  });
});
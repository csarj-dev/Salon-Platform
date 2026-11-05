import { describe, expect, it } from "vitest";
import { parseCollectorsArgs } from "./collectors-cli";

const ids = ["salon", "amanda"];

describe("parseCollectorsArgs", () => {
  it("list, set y clear", () => {
    expect(parseCollectorsArgs(["list"], ids)).toEqual({ kind: "list" });
    expect(parseCollectorsArgs(["set", "28", "amanda"], ids)).toEqual({ kind: "set", staffId: 28, collector: "amanda" });
    expect(parseCollectorsArgs(["clear", "28"], ids)).toEqual({ kind: "clear", staffId: 28 });
  });

  it("solo cobradores que están en el config", () => {
    expect(() => parseCollectorsArgs(["set", "28", "luz"], ids)).toThrow(/"luz" no está en el config \(hay: salon, amanda\)/);
  });

  it("rechaza ids raros y órdenes desconocidas", () => {
    expect(() => parseCollectorsArgs(["set", "x", "amanda"], ids)).toThrow(/Id de profesional no válido/);
    expect(() => parseCollectorsArgs(["clear", "0"], ids)).toThrow(/Id de profesional no válido/);
    expect(() => parseCollectorsArgs(["borrar", "28"], ids)).toThrow(/Uso:/);
    expect(() => parseCollectorsArgs(["list", "de", "más"], ids)).toThrow(/Uso:/);
  });
});
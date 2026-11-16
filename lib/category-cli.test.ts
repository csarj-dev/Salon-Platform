import { describe, expect, it } from "vitest";
import { normalizeHexColor, parseCategoryColorArgs } from "./category-cli";

describe("normalizeHexColor", () => {
  it("acepta con o sin #, mayúsculas y la forma corta", () => {
    expect(normalizeHexColor("#B0607C")).toBe("#b0607c");
    expect(normalizeHexColor("b0607c")).toBe("#b0607c");
    expect(normalizeHexColor("#b06")).toBe("#bb0066");
  });

  it("rechaza lo que no es un color", () => {
    expect(() => normalizeHexColor("rosa")).toThrow();
    expect(() => normalizeHexColor("#12345")).toThrow();
  });
});

describe("parseCategoryColorArgs", () => {
  it("sin nada: listar", () => {
    expect(parseCategoryColorArgs([])).toEqual({ command: "list" });
  });

  it("por id o por nombre, con color o sin él", () => {
    expect(parseCategoryColorArgs(["3", "#5F7FA6"])).toEqual({ command: "set", category: 3, color: "#5f7fa6" });
    expect(parseCategoryColorArgs(["Cejas", "b0607c"])).toEqual({ command: "set", category: "Cejas", color: "#b0607c" });
    expect(parseCategoryColorArgs(["Cejas", "--none"])).toEqual({ command: "set", category: "Cejas", color: null });
  });

  it("falta algo o sobra algo: explica el uso", () => {
    expect(() => parseCategoryColorArgs(["Cejas"])).toThrow(/Uso/);
    expect(() => parseCategoryColorArgs(["Cejas", "--rojo"])).toThrow(/desconocida/);
  });
});
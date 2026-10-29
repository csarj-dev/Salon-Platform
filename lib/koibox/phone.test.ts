import { describe, expect, it } from "vitest";
import { phoneVariants, splitName, splitPhone } from "./phone";

describe("splitPhone", () => {
  it("separa el prefijo del salón", () => {
    expect(splitPhone("+34612345678", "34")).toEqual({ number: "612345678", prefix: "34" });
    expect(splitPhone("0034612345678", "34")).toEqual({ number: "612345678", prefix: "34" });
  });

  it("sin prefijo usa el del salón", () => {
    expect(splitPhone("612 345 678", "34")).toEqual({ number: "612345678", prefix: "34" });
  });

  it("con prefijo de otro país deja el número entero", () => {
    expect(splitPhone("+447700900123", "34")).toEqual({ number: "447700900123", prefix: "" });
  });
});

describe("phoneVariants", () => {
  it("prueba las formas habituales de escribir un móvil español", () => {
    expect(phoneVariants("+34612345678", "34")).toEqual([
      "612345678",
      "612 345 678",
      "+34612345678",
      "34612345678",
      "+34 612345678",
    ]);
  });

  it("un número extranjero se busca con y sin +", () => {
    expect(phoneVariants("+447700900123", "34")).toEqual(["447700900123", "+447700900123"]);
  });
});

describe("splitName", () => {
  it("la primera palabra es el nombre y el resto los apellidos", () => {
    expect(splitName("  Laura  Gómez Pérez ")).toEqual({ firstName: "Laura", lastName: "Gómez Pérez" });
    expect(splitName("Laura")).toEqual({ firstName: "Laura" });
  });
});
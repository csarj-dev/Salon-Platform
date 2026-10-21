import { describe, it, expect } from "vitest";
import { initialsOf } from "./initials";

describe("initialsOf", () => {
  it("usa la inicial de las dos primeras palabras", () => {
    expect(initialsOf("Ana María López")).toBe("AM");
  });
  it("con una sola palabra devuelve una letra", () => {
    expect(initialsOf("ana")).toBe("A");
  });
  it("ignora espacios sobrantes", () => {
    expect(initialsOf("  Lucía   Pérez ")).toBe("LP");
  });
  it("con un nombre vacío devuelve vacío", () => {
    expect(initialsOf("   ")).toBe("");
  });
  it("no rompe los caracteres fuera del plano básico", () => {
    expect(initialsOf("😀 Ana")).toBe("😀A");
  });
});
import { describe, it, expect } from "vitest";
import { pickTranslation } from "./pick-translation";

const es = { locale: "es", name: "Laminado de cejas", description: "Cejas definidas" };
const en = { locale: "en", name: "Brow lamination", description: null };

describe("pickTranslation", () => {
  it("usa el idioma pedido si existe", () => {
    expect(pickTranslation([es, en], "en", "es", "interno").name).toBe("Brow lamination");
  });

  it("usa el idioma por defecto si falta el pedido", () => {
    expect(pickTranslation([es], "en", "es", "interno").name).toBe("Laminado de cejas");
  });

  it("usa el nombre interno si no hay ninguna traducción", () => {
    expect(pickTranslation([], "en", "es", "interno")).toEqual({
      name: "interno",
      description: null,
    });
  });
});
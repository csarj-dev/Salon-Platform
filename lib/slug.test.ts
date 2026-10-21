import { describe, it, expect } from "vitest";
import { assignSlugs, isValidSlug, slugify } from "./slug";

describe("slugify", () => {
  it("pasa a minúsculas y une con guiones", () => {
    expect(slugify("The Room Centro")).toBe("the-room-centro");
  });
  it("quita acentos y la ñ", () => {
    expect(slugify("Pestañas Ñandú")).toBe("pestanas-nandu");
  });
  it("colapsa símbolos y recorta guiones de los extremos", () => {
    expect(slugify("  --Centro & Sur!!  ")).toBe("centro-sur");
  });
  it("si no queda nada devuelve un valor por defecto", () => {
    expect(slugify("!!!")).toBe("location");
  });
});

describe("assignSlugs", () => {
  it("no repite slugs", () => {
    expect(assignSlugs(["Centro", "Sur", "Centro", "CENTRO"])).toEqual([
      "centro", "sur", "centro-2", "centro-3",
    ]);
  });
});

describe("isValidSlug", () => {
  it("acepta slugs bien formados", () => {
    expect(isValidSlug("the-room-centro")).toBe(true);
    expect(isValidSlug("sur2")).toBe(true);
  });
  it("rechaza lo demás", () => {
    for (const bad of ["", "-a", "a-", "a--b", "A", "a b", "a/b", "../x"]) {
      expect(isValidSlug(bad)).toBe(false);
    }
  });
});
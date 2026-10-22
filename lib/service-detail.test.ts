import { describe, it, expect } from "vitest";
import { hasServiceDetail, pickLongDescription, splitParagraphs } from "./service-detail";

describe("pickLongDescription", () => {
  const rows = [
    { locale: "es", longDescription: "Texto en español" },
    { locale: "en", longDescription: null },
  ];

  it("usa el idioma pedido si tiene texto", () => {
    expect(pickLongDescription([{ locale: "en", longDescription: "English" }, ...rows], "en", "es")).toBe("English");
  });
  it("si el idioma pedido no tiene texto, usa el idioma por defecto", () => {
    expect(pickLongDescription(rows, "en", "es")).toBe("Texto en español");
    expect(pickLongDescription(rows, "fr", "es")).toBe("Texto en español");
  });
  it("un texto en blanco cuenta como vacío", () => {
    expect(pickLongDescription([{ locale: "es", longDescription: "   \n " }], "es", "es")).toBeNull();
  });
  it("sin ningún texto devuelve null", () => {
    expect(pickLongDescription([], "es", "es")).toBeNull();
  });
});

describe("hasServiceDetail", () => {
  it("necesita slug y algún contenido", () => {
    expect(hasServiceDetail({ slug: "a", longDescription: "x", galleryCount: 0 })).toBe(true);
    expect(hasServiceDetail({ slug: "a", longDescription: null, galleryCount: 2 })).toBe(true);
  });
  it("sin contenido no hay página", () => {
    expect(hasServiceDetail({ slug: "a", longDescription: null, galleryCount: 0 })).toBe(false);
  });
  it("sin slug no hay página aunque haya contenido", () => {
    expect(hasServiceDetail({ slug: null, longDescription: "x", galleryCount: 3 })).toBe(false);
  });
});

describe("splitParagraphs", () => {
  it("separa por líneas en blanco y recorta", () => {
    expect(splitParagraphs("Uno\n\nDos\n\n\n  Tres  ")).toEqual(["Uno", "Dos", "Tres"]);
  });
  it("un salto de línea simple no separa párrafos", () => {
    expect(splitParagraphs("Uno\nDos")).toEqual(["Uno\nDos"]);
  });
  it("texto vacío da una lista vacía", () => {
    expect(splitParagraphs("  ")).toEqual([]);
  });
});
import { describe, it, expect } from "vitest";
import { missingAltLocales, parseAttachArgs } from "./photo-cli";

describe("parseAttachArgs", () => {
  it("lee entidad, id, archivo y textos alternativos", () => {
    expect(
      parseAttachArgs(["location", "2", "C:\\fotos\\a b.jpg", "--alt-es", "Fachada", "--alt-en", "Storefront"]),
    ).toEqual({
      entity: "location",
      id: 2,
      file: "C:\\fotos\\a b.jpg",
      alt: { es: "Fachada", en: "Storefront" },
    });
  });

  it("acepta los textos antes de los argumentos de posición", () => {
    const a = parseAttachArgs(["--alt-es", "Ana", "staff", "1", "ana.jpg"]);
    expect(a.entity).toBe("staff");
    expect(a.alt).toEqual({ es: "Ana" });
  });

  it("rechaza una entidad que no existe", () => {
    expect(() => parseAttachArgs(["client", "1", "a.jpg"])).toThrow(/Entidad no válida/);
  });

  it("rechaza un id que no es un entero positivo", () => {
    expect(() => parseAttachArgs(["service", "abc", "a.jpg"])).toThrow(/Id no válido/);
    expect(() => parseAttachArgs(["service", "0", "a.jpg"])).toThrow(/Id no válido/);
    expect(() => parseAttachArgs(["service", "1.5", "a.jpg"])).toThrow(/Id no válido/);
  });

  it("rechaza si faltan argumentos de posición", () => {
    expect(() => parseAttachArgs(["service", "1"])).toThrow(/Uso:/);
  });

  it("rechaza opciones desconocidas y textos sin valor", () => {
    expect(() => parseAttachArgs(["service", "1", "a.jpg", "--foo", "x"])).toThrow(/Opción desconocida/);
    expect(() => parseAttachArgs(["service", "1", "a.jpg", "--alt-es"])).toThrow(/Falta el texto/);
    expect(() => parseAttachArgs(["service", "1", "a.jpg", "--alt-es", "--alt-en", "x"])).toThrow(/Falta el texto/);
  });
});

describe("missingAltLocales", () => {
  it("devuelve los idiomas sin texto", () => {
    expect(missingAltLocales({ es: "Hola" }, ["es", "en"])).toEqual(["en"]);
    expect(missingAltLocales({ es: "Hola", en: "Hi" }, ["es", "en"])).toEqual([]);
  });
});

describe("location-gallery", () => {
  it("se acepta como entidad", () => {
    const a = parseAttachArgs(["location-gallery", "1", "a.webp", "--alt-es", "Sala"]);
    expect(a.entity).toBe("location-gallery");
  });
});

describe("service-gallery", () => {
  it("se acepta como entidad", () => {
    const a = parseAttachArgs(["service-gallery", "26", "a.webp", "--alt-es", "Resultado"]);
    expect(a.entity).toBe("service-gallery");
  });
});
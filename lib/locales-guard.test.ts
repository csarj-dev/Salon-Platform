import { describe, it, expect } from "vitest";
import { assertLocalesMatch } from "./locales-guard";

describe("assertLocalesMatch", () => {
  it("acepta idiomas iguales aunque estén en distinto orden", () => {
    expect(() =>
      assertLocalesMatch(
        { locales: ["es", "en"], defaultLocale: "es" },
        { locales: ["en", "es"], defaultLocale: "es" },
      ),
    ).not.toThrow();
  });

  it("rechaza un idioma que falta", () => {
    expect(() =>
      assertLocalesMatch(
        { locales: ["es", "en"], defaultLocale: "es" },
        { locales: ["es"], defaultLocale: "es" },
      ),
    ).toThrow();
  });

  it("rechaza un idioma por defecto distinto", () => {
    expect(() =>
      assertLocalesMatch(
        { locales: ["es", "en"], defaultLocale: "es" },
        { locales: ["es", "en"], defaultLocale: "en" },
      ),
    ).toThrow();
  });
});
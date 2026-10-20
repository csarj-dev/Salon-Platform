import { describe, it, expect } from "vitest";
import { salonConfigSchema } from "./salon-config";
import { themeToCssVars } from "./theme";

const base = {
  name: "Salón de prueba",
  timezone: "Europe/Madrid",
  locales: ["es"],
  defaultLocale: "es",
  booking: {},
};

describe("tema del salón", () => {
  it("sin tema usa el neutro por defecto", () => {
    const c = salonConfigSchema.parse(base);
    expect(c.theme.primary).toBe("#171717");
    expect(c.theme.radius).toBe("0.5rem");
  });

  it("un tema parcial se completa con los valores por defecto", () => {
    const c = salonConfigSchema.parse({ ...base, theme: { primary: "#8b5e3c" } });
    expect(c.theme.primary).toBe("#8b5e3c");
    expect(c.theme.background).toBe("#ffffff");
  });

  it("rechaza un color que no es hexadecimal", () => {
    expect(() =>
      salonConfigSchema.parse({ ...base, theme: { primary: "rojo" } }),
    ).toThrow();
  });

  it("genera las variables CSS de shadcn", () => {
    const vars = themeToCssVars(
      salonConfigSchema.parse({ ...base, theme: { primary: "#8b5e3c" } }).theme,
    );
    expect(vars["--primary"]).toBe("#8b5e3c");
    expect(vars["--ring"]).toBe("#8b5e3c");
    expect(vars["--radius"]).toBe("0.5rem");
  });
});
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

  it("trae colores de estado por defecto y danger es también el rojo de shadcn", () => {
    const vars = themeToCssVars(
      salonConfigSchema.parse({ ...base, theme: { danger: "#8a3b2e" } }).theme,
    );
    expect(vars["--success"]).toBe("#2f7d4a");
    expect(vars["--warning"]).toBe("#a16207");
    expect(vars["--danger"]).toBe("#8a3b2e");
    expect(vars["--destructive"]).toBe("#8a3b2e");
  });
});

describe("color de cada cobrador", () => {
  const withCollector = (color: string) => ({
    ...base,
    payments: { collectors: { salon: { label: "Salón", color } } },
  });

  it("se guarda si es hexadecimal", () => {
    expect(salonConfigSchema.parse(withCollector("#8a9a7b")).payments.collectors.salon.color).toBe("#8a9a7b");
  });

  it("rechaza un color que no es hexadecimal", () => {
    expect(() => salonConfigSchema.parse(withCollector("verde"))).toThrow();
  });
});
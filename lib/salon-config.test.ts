import { describe, it, expect } from "vitest";
import { salonConfigSchema } from "./salon-config";

const valid = {
  name: "Salón de prueba",
  timezone: "Europe/Madrid",
  locales: ["es"],
  defaultLocale: "es",
  booking: {},
};

describe("salonConfigSchema", () => {
  it("acepta una configuración válida y rellena los valores por defecto", () => {
    const c = salonConfigSchema.parse(valid);
    expect(c.booking.slotStepMin).toBe(30);
    expect(c.booking.bufferMin).toBe(0);
    expect(c.booking.minNoticeHours).toBe(2);
  });

  it("rechaza una zona horaria que no existe", () => {
    expect(() =>
      salonConfigSchema.parse({ ...valid, timezone: "Europe/Madird" }),
    ).toThrow();
  });

  it("rechaza un paso entre huecos de cero o negativo", () => {
    expect(() =>
      salonConfigSchema.parse({ ...valid, booking: { slotStepMin: 0 } }),
    ).toThrow();
  });

  it("rechaza una configuración sin idiomas", () => {
    expect(() =>
      salonConfigSchema.parse({ ...valid, locales: [] }),
    ).toThrow();
  });

    it("sin initialLocations usa una lista vacía", () => {
    const c = salonConfigSchema.parse(valid);
    expect(c.initialLocations).toEqual([]);
  });

  it("acepta varios locales iniciales", () => {
    const c = salonConfigSchema.parse({
      ...valid,
      initialLocations: [{ name: "Centro" }, { name: "Sur", phone: "922000000" }],
    });
    expect(c.initialLocations).toHaveLength(2);
  });
});
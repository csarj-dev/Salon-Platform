import { describe, expect, it } from "vitest";
import { depositHoldHours } from "./deposit";
import { salonConfigSchema } from "./salon-config";

describe("depositHoldHours", () => {
  const deposit = { holdHours: 24, cardHoldMinutes: 15 };

  it("con tarjeta se guarda la hora unos minutos; si no, las horas de siempre", () => {
    expect(depositHoldHours("card", deposit)).toBe(0.25);
    expect(depositHoldHours("whatsapp", deposit)).toBe(24);
    expect(depositHoldHours("instructions", deposit)).toBe(24);
  });

  it("el config admite el modo tarjeta y trae 15 minutos por defecto", () => {
    const c = salonConfigSchema.parse({
      name: "Salón de prueba",
      timezone: "Atlantic/Canary",
      locales: ["es"],
      defaultLocale: "es",
      booking: {},
      payments: { collectors: { yo: { label: "Yo", deposit: { mode: "card" } } } },
    });
    expect(c.booking.deposit.cardHoldMinutes).toBe(15);
    expect(c.payments.collectors.yo.deposit.mode).toBe("card");
  });

  it("los minutos con tarjeta van de 5 a 120", () => {
    const base = { name: "S", timezone: "Atlantic/Canary", locales: ["es"], defaultLocale: "es" };
    expect(() => salonConfigSchema.parse({ ...base, booking: { deposit: { cardHoldMinutes: 2 } } })).toThrow();
    expect(() => salonConfigSchema.parse({ ...base, booking: { deposit: { cardHoldMinutes: 121 } } })).toThrow();
  });
});
import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import { salonConfigSchema } from "../salon-config";
import { buildDepositCodeEmail } from "./deposit-code-email";

const config = salonConfigSchema.parse({
  name: "The Room",
  timezone: "Atlantic/Canary",
  locales: ["es", "en"],
  defaultLocale: "es",
  contact: { whatsapp: "34600000000" },
  booking: {},
});

describe("correo del código del depósito guardado", () => {
  it("lleva el código, el importe y cuánto dura", () => {
    const mail = buildDepositCodeEmail({ to: "ana@example.com", code: "048317", cents: 1500, locale: "es" }, config, es);
    expect(mail.subject).toBe("Tu código: 048317 · The Room");
    expect(mail.text).toContain("048317");
    expect(mail.text).toContain("15,00");
    expect(mail.text).toContain("10 minutos");
  });

  it("en inglés", () => {
    const mail = buildDepositCodeEmail({ to: "ana@example.com", code: "048317", cents: 1500, locale: "en" }, config, en);
    expect(mail.subject).toBe("Your code: 048317 · The Room");
  });
});
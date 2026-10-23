import { describe, expect, it } from "vitest";
import { bookingInputSchema, clientFormSchema } from "./booking-schema";

const person = { name: "Ana Pérez", phone: "600 111 222" };

describe("clientFormSchema (formulario web)", () => {
  it("exige un email válido", () => {
    expect(clientFormSchema.safeParse({ ...person, email: "ana@example.com" }).success).toBe(true);
    expect(clientFormSchema.safeParse({ ...person, email: "" }).success).toBe(false);
    expect(clientFormSchema.safeParse(person).success).toBe(false);
    expect(clientFormSchema.safeParse({ ...person, email: "no-es-email" }).success).toBe(false);
  });
});

describe("bookingInputSchema (al crear la cita)", () => {
  const base = {
    locationId: 1,
    serviceId: 1,
    staffId: 1,
    startsAt: "2026-11-02T10:00:00Z",
    consent: true,
  };

  it("recepción puede crear una cita sin email", () => {
    const r = bookingInputSchema.safeParse({ ...base, source: "phone", client: person });
    expect(r.success).toBe(true);
  });

  it("acepta el idioma de la clienta", () => {
    const r = bookingInputSchema.parse({ ...base, client: person, locale: "en" });
    expect(r.locale).toBe("en");
  });
});
import { describe, it, expect } from "vitest";
import { depositDueAt, depositForServices, isDepositOverdue, paysThroughWhatsApp } from "./deposit";

const NOW = new Date("2026-11-02T10:00:00Z");

describe("depositDueAt", () => {
  it("guarda el hueco las horas indicadas", () => {
    const startsAt = new Date("2026-11-20T10:00:00Z");
    expect(depositDueAt(NOW, startsAt, 24)).toEqual(new Date("2026-11-03T10:00:00Z"));
  });

  it("admite horas con decimales", () => {
    const startsAt = new Date("2026-11-20T10:00:00Z");
    expect(depositDueAt(NOW, startsAt, 1.5)).toEqual(new Date("2026-11-02T11:30:00Z"));
  });

  it("nunca pasa del inicio de la cita", () => {
    const startsAt = new Date("2026-11-02T14:00:00Z"); // en 4 horas
    expect(depositDueAt(NOW, startsAt, 24)).toEqual(startsAt);
  });
});

describe("isDepositOverdue", () => {
  const pending = (due: string | null) => ({
    status: "pending_deposit",
    depositDueAt: due ? new Date(due) : null,
  });

  it("vence justo en el instante del plazo", () => {
    expect(isDepositOverdue(pending("2026-11-02T10:00:00Z"), NOW)).toBe(true);
    expect(isDepositOverdue(pending("2026-11-02T09:59:59Z"), NOW)).toBe(true);
  });

  it("antes del plazo no vence", () => {
    expect(isDepositOverdue(pending("2026-11-02T10:00:01Z"), NOW)).toBe(false);
  });

  it("solo las pendientes pueden vencer", () => {
    const booked = { status: "booked", depositDueAt: new Date("2026-11-01T00:00:00Z") };
    expect(isDepositOverdue(booked, NOW)).toBe(false);
  });

  it("sin plazo no vence", () => {
    expect(isDepositOverdue(pending(null), NOW)).toBe(false);
  });
});

describe("paysThroughWhatsApp", () => {
  it("solo manda a WhatsApp con ese modo y una cita pendiente de depósito", () => {
    expect(paysThroughWhatsApp("whatsapp", "pending_deposit")).toBe(true);
    expect(paysThroughWhatsApp("whatsapp", "booked")).toBe(false);
    expect(paysThroughWhatsApp("instructions", "pending_deposit")).toBe(false);
    expect(paysThroughWhatsApp("instructions", "booked")).toBe(false);
  });
});

describe("depositForServices", () => {
  const cejas = (cents: number | null) => ({ categoryId: 1, depositCents: cents });
  const pestanas = (cents: number | null) => ({ categoryId: 2, depositCents: cents });

  it("un servicio: su depósito", () => {
    expect(depositForServices([cejas(1500)])).toBe(1500);
  });

  it("varios de la misma categoría: uno solo", () => {
    expect(depositForServices([cejas(1500), cejas(1500)])).toBe(1500);
  });

  it("de categorías distintas: se suman", () => {
    expect(depositForServices([cejas(1500), pestanas(2000)])).toBe(3500);
  });

  it("en la misma categoría con importes distintos, el mayor", () => {
    expect(depositForServices([cejas(1000), cejas(1500)])).toBe(1500);
  });

  it("los que no piden depósito no cuentan", () => {
    expect(depositForServices([cejas(1500), pestanas(null)])).toBe(1500);
    expect(depositForServices([cejas(null), pestanas(null)])).toBeNull();
    expect(depositForServices([])).toBeNull();
  });

  it("un servicio sin categoría cuenta aparte", () => {
    const loose = { categoryId: null, depositCents: 1000 };
    expect(depositForServices([loose, loose])).toBe(2000);
  });
});
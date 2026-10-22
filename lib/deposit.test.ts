import { describe, it, expect } from "vitest";
import { depositDueAt, isDepositOverdue } from "./deposit";

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

import { describe, it, expect } from "vitest";
import { localToInstant } from "./timezone";

const ZONE = "Atlantic/Canary";

describe("localToInstant", () => {
  it("en verano (UTC+1) las 10:00 locales son las 09:00 UTC", () => {
    const d = localToInstant("2026-10-24", "10:00", ZONE);
    expect(d.toISOString()).toBe("2026-10-24T09:00:00.000Z");
  });

  it("en invierno (UTC+0) las 10:00 locales son las 10:00 UTC", () => {
    const d = localToInstant("2026-10-26", "10:00", ZONE);
    expect(d.toISOString()).toBe("2026-10-26T10:00:00.000Z");
  });

  it("acepta horas con segundos, como las devuelve Postgres", () => {
    const d = localToInstant("2026-11-02", "16:00:00", ZONE);
    expect(d.toISOString()).toBe("2026-11-02T16:00:00.000Z");
  });

  it("falla con una hora inválida", () => {
    expect(() => localToInstant("2026-11-02", "25:99", ZONE)).toThrow();
  });
});
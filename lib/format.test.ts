import { describe, it, expect } from "vitest";
import { formatPrice } from "./format";

describe("formatPrice", () => {
  it("formatea en euros según el idioma", () => {
    expect(formatPrice(4500, "es", "EUR")).toMatch(/45,00\s?€/);
    expect(formatPrice(4500, "en", "EUR")).toBe("€45.00");
  });

  it("conserva los céntimos", () => {
    expect(formatPrice(1850, "es", "EUR")).toMatch(/18,50/);
  });
});
import { describe, expect, it } from "vitest";
import { needsWhatsAppTab } from "./whatsapp-tab";

describe("needsWhatsAppTab", () => {
  const base = { mode: "whatsapp" as const, whatsapp: "+34600000000", depositCents: 2000 };

  it("sí: modo WhatsApp, salón con WhatsApp y servicio con depósito", () => {
    expect(needsWhatsAppTab(base)).toBe(true);
  });
  it("no: el salón cobra con instrucciones", () => {
    expect(needsWhatsAppTab({ ...base, mode: "instructions" })).toBe(false);
  });
  it("no: el servicio no lleva depósito", () => {
    expect(needsWhatsAppTab({ ...base, depositCents: null })).toBe(false);
    expect(needsWhatsAppTab({ ...base, depositCents: 0 })).toBe(false);
  });
  it("no: el salón no tiene WhatsApp", () => {
    expect(needsWhatsAppTab({ ...base, whatsapp: undefined })).toBe(false);
    expect(needsWhatsAppTab({ ...base, whatsapp: "" })).toBe(false);
  });
});
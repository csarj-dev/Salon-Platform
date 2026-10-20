import { describe, it, expect } from "vitest";
import { buildWhatsAppLink } from "./whatsapp-link";

describe("buildWhatsAppLink", () => {
  it("sin mensaje devuelve solo el chat", () => {
    expect(buildWhatsAppLink("34600000000")).toBe("https://wa.me/34600000000");
  });

  it("limpia espacios, + y guiones del teléfono", () => {
    expect(buildWhatsAppLink("+34 600-000 000")).toBe("https://wa.me/34600000000");
  });

  it("codifica el mensaje (tildes, espacios y símbolos)", () => {
    const url = buildWhatsAppLink("34600000000", "Hola, quiero reservar Diseño & Laminado?");
    expect(url).toBe(
      "https://wa.me/34600000000?text=Hola%2C%20quiero%20reservar%20Dise%C3%B1o%20%26%20Laminado%3F",
    );
    // Ida y vuelta: lo que llega a WhatsApp es el mensaje original
    expect(decodeURIComponent(new URL(url).searchParams.get("text")!)).toBe(
      "Hola, quiero reservar Diseño & Laminado?",
    );
  });

  it("ignora un mensaje vacío o de solo espacios", () => {
    expect(buildWhatsAppLink("34600000000", "   ")).toBe("https://wa.me/34600000000");
  });

  it("lanza un error si el teléfono no tiene dígitos", () => {
    expect(() => buildWhatsAppLink("abc")).toThrow();
  });
});
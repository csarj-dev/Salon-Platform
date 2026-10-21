import { describe, it, expect } from "vitest";
import { heroCta, instagramUrl, serviceWhatsApp } from "./showcase-links";

describe("serviceWhatsApp", () => {
  it("sin número devuelve null", () => {
    expect(serviceWhatsApp(undefined, { book: "a", consult: "b" })).toBeNull();
  });

  it("construye un enlace para reservar y otro para consultar", () => {
    const r = serviceWhatsApp("34600000000", { book: "Reservar", consult: "Consultar" });
    expect(r).toEqual({
      book: "https://wa.me/34600000000?text=Reservar",
      consult: "https://wa.me/34600000000?text=Consultar",
    });
  });
});

describe("heroCta", () => {
  const wa = "https://wa.me/1";

  it("con canal online, el botón principal lleva a reservar (aunque haya whatsapp)", () => {
    expect(heroCta({ channels: ["whatsapp", "online"], whatsappHref: wa })).toEqual({
      type: "internal", href: "/booking", labelKey: "book",
    });
  });

  it("solo whatsapp: abre WhatsApp", () => {
    expect(heroCta({ channels: ["whatsapp"], whatsappHref: wa })).toEqual({
      type: "whatsapp", href: wa, labelKey: "whatsappBook",
    });
  });

  it("sin canales: lleva a la carta", () => {
    expect(heroCta({ channels: [], whatsappHref: wa })).toEqual({
      type: "internal", href: "/services", labelKey: "viewMenu",
    });
  });

  it("canal whatsapp sin enlace: lleva a la carta", () => {
    expect(heroCta({ channels: ["whatsapp"], whatsappHref: null })).toEqual({
      type: "internal", href: "/services", labelKey: "viewMenu",
    });
  });
});

describe("instagramUrl", () => {
  it("acepta el usuario con o sin @ y con barra final", () => {
    expect(instagramUrl("theroom.estudio")).toBe("https://www.instagram.com/theroom.estudio/");
    expect(instagramUrl("@theroom.estudio/")).toBe("https://www.instagram.com/theroom.estudio/");
  });
});
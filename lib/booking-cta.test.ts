import { describe, it, expect } from "vitest";
import { resolveBookingCta } from "./booking-cta";

const wa = { book: "https://wa.me/1?text=book", consult: "https://wa.me/1?text=consult" };
const normal = { id: 7, requiresConsultation: false };
const consult = { id: 8, requiresConsultation: true };
const base = { service: normal, locationId: 3, whatsapp: wa };

describe("resolveBookingCta", () => {
  it("solo online: un botón que enlaza al flujo con local y servicio", () => {
    const r = resolveBookingCta({ ...base, channels: ["online"] });
    expect(r).toEqual([
      {
        type: "internal",
        href: { pathname: "/booking", query: { location: "3", service: "7" } },
        labelKey: "book",
      },
    ]);
  });

  it("solo whatsapp: un botón que abre WhatsApp con el mensaje de reserva", () => {
    expect(resolveBookingCta({ ...base, channels: ["whatsapp"] })).toEqual([
      { type: "whatsapp", href: wa.book, labelKey: "whatsappBook" },
    ]);
  });

  it("online y whatsapp: dos botones, el online primero", () => {
    const r = resolveBookingCta({ ...base, channels: ["whatsapp", "online"] });
    expect(r.map((c) => c.type)).toEqual(["internal", "whatsapp"]);
  });

  it("sin canales: no hay botones, ni siquiera en servicios con consulta", () => {
    expect(resolveBookingCta({ ...base, channels: [] })).toEqual([]);
    expect(resolveBookingCta({ ...base, service: consult, channels: [] })).toEqual([]);
  });

  it("canal whatsapp sin enlace disponible: no hay botón de whatsapp", () => {
    expect(resolveBookingCta({ ...base, whatsapp: null, channels: ["whatsapp"] })).toEqual([]);
  });

  it("un servicio con consulta previa va solo a WhatsApp aunque el canal sea online", () => {
    expect(resolveBookingCta({ ...base, service: consult, channels: ["online"] })).toEqual([
      { type: "whatsapp", href: wa.consult, labelKey: "whatsappConsult" },
    ]);
  });

  it("un servicio con consulta previa sin WhatsApp no tiene botones", () => {
    expect(
      resolveBookingCta({ ...base, service: consult, whatsapp: null, channels: ["online"] }),
    ).toEqual([]);
  });
});
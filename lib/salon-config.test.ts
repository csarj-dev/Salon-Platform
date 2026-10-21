import { describe, it, expect } from "vitest";
import { applyEnvOverrides, salonConfigSchema } from "./salon-config";

const valid = {
  name: "Salón de prueba",
  timezone: "Europe/Madrid",
  locales: ["es"],
  defaultLocale: "es",
  booking: {},
};

describe("salonConfigSchema", () => {
  it("acepta una configuración válida y rellena los valores por defecto", () => {
    const c = salonConfigSchema.parse(valid);
    expect(c.booking.slotStepMin).toBe(30);
    expect(c.booking.bufferMin).toBe(0);
    expect(c.booking.minNoticeHours).toBe(2);
  });

  it("rechaza una zona horaria que no existe", () => {
    expect(() =>
      salonConfigSchema.parse({ ...valid, timezone: "Europe/Madird" }),
    ).toThrow();
  });

  it("rechaza un paso entre huecos de cero o negativo", () => {
    expect(() =>
      salonConfigSchema.parse({ ...valid, booking: { slotStepMin: 0 } }),
    ).toThrow();
  });

  it("rechaza una configuración sin idiomas", () => {
    expect(() =>
      salonConfigSchema.parse({ ...valid, locales: [] }),
    ).toThrow();
  });

  it("sin initialLocations usa una lista vacía", () => {
    const c = salonConfigSchema.parse(valid);
    expect(c.initialLocations).toEqual([]);
  });

  it("acepta varios locales iniciales", () => {
    const c = salonConfigSchema.parse({
      ...valid,
      initialLocations: [{ name: "Centro" }, { name: "Sur", phone: "922000000" }],
    });
    expect(c.initialLocations).toHaveLength(2);
  });
});

describe("contacto", () => {
  it("sin contacto usa un objeto vacío", () => {
    expect(salonConfigSchema.parse(valid).contact).toEqual({});
  });

  it("limpia el WhatsApp y lo deja solo con dígitos", () => {
    const c = salonConfigSchema.parse({
      ...valid,
      contact: { whatsapp: "+34 600-000 000" },
    });
    expect(c.contact.whatsapp).toBe("34600000000");
  });

  it("rechaza un WhatsApp con letras o demasiado corto", () => {
    expect(() =>
      salonConfigSchema.parse({ ...valid, contact: { whatsapp: "abc123" } }),
    ).toThrow();
    expect(() =>
      salonConfigSchema.parse({ ...valid, contact: { whatsapp: "1234" } }),
    ).toThrow();
  });

  it("rechaza un email mal formado", () => {
    expect(() =>
      salonConfigSchema.parse({ ...valid, contact: { email: "no-es-un-email" } }),
    ).toThrow();
  });
});

describe("canales de reserva", () => {
  it("por defecto el único canal de reserva es online", () => {
    expect(salonConfigSchema.parse(valid).booking.channels).toEqual(["online"]);
  });

  it("rechaza el canal whatsapp si no hay número", () => {
    expect(() =>
      salonConfigSchema.parse({ ...valid, booking: { channels: ["whatsapp"] } }),
    ).toThrow();
  });

  it("acepta el canal whatsapp con número", () => {
    expect(() =>
      salonConfigSchema.parse({
        ...valid,
        contact: { whatsapp: "34600000000" },
        booking: { channels: ["online", "whatsapp"] },
      }),
    ).not.toThrow();
  });

  it("acepta una lista vacía de canales (solo carta informativa)", () => {
    expect(
      salonConfigSchema.parse({ ...valid, booking: { channels: [] } }).booking.channels,
    ).toEqual([]);
  });

  it("rechaza un canal que no existe", () => {
    expect(() =>
      salonConfigSchema.parse({ ...valid, booking: { channels: ["telegram"] } }),
    ).toThrow();
  });
});

describe("galería", () => {
  const bilingual = { ...valid, locales: ["es", "en"] };

  it("sin galería usa una lista vacía", () => {
    expect(salonConfigSchema.parse(valid).gallery).toEqual([]);
  });

  it("acepta una foto sin src (marcador de posición gris)", () => {
    const c = salonConfigSchema.parse({
      ...bilingual,
      gallery: [{ width: 1080, height: 1350, alt: { es: "Cejas", en: "Brows" } }],
    });
    expect(c.gallery[0].src).toBeUndefined();
  });

  it("rechaza una foto sin texto alternativo en alguno de los idiomas", () => {
    expect(() =>
      salonConfigSchema.parse({
        ...bilingual,
        gallery: [{ width: 1080, height: 1080, alt: { es: "Cejas" } }],
      }),
    ).toThrow();
  });

  it("rechaza un texto alternativo vacío", () => {
    expect(() =>
      salonConfigSchema.parse({
        ...bilingual,
        gallery: [{ width: 1080, height: 1080, alt: { es: "Cejas", en: "  " } }],
      }),
    ).toThrow();
  });

  it("rechaza medidas que no son positivas", () => {
    expect(() =>
      salonConfigSchema.parse({
        ...valid,
        gallery: [{ width: 0, height: 100, alt: { es: "x" } }],
      }),
    ).toThrow();
  });
});

describe("applyEnvOverrides", () => {
  it("SALON_WHATSAPP sustituye el número de la config y conserva el resto", () => {
    const raw = { contact: { whatsapp: "34600000000", instagram: "theroom.estudio" } };
    const out = applyEnvOverrides(raw, { SALON_WHATSAPP: "34611111111" }) as typeof raw;
    expect(out.contact.whatsapp).toBe("34611111111");
    expect(out.contact.instagram).toBe("theroom.estudio");
  });

  it("crea el contacto si la config no lo tenía", () => {
    const out = applyEnvOverrides({}, { SALON_WHATSAPP: "34611111111" }) as {
      contact: { whatsapp: string };
    };
    expect(out.contact.whatsapp).toBe("34611111111");
  });

  it("sin variable (o vacía) devuelve la config tal cual", () => {
    const raw = { contact: { whatsapp: "34600000000" } };
    expect(applyEnvOverrides(raw, {})).toBe(raw);
    expect(applyEnvOverrides(raw, { SALON_WHATSAPP: "  " })).toBe(raw);
  });
});

describe("portada", () => {
  const bilingual = { ...valid, locales: ["es", "en"] };
  const alt = { es: "El equipo", en: "The team" };

  it("sin portada no hay hero (se usa la portada de texto)", () => {
    expect(salonConfigSchema.parse(valid).hero).toBeUndefined();
  });

  it("acepta una portada sin src (marcador gris)", () => {
    const c = salonConfigSchema.parse({ ...bilingual, hero: { width: 1920, height: 1080, alt } });
    expect(c.hero?.src).toBeUndefined();
  });

  it("acepta una portada con src", () => {
    const c = salonConfigSchema.parse({
      ...bilingual,
      hero: { src: "/salons/the-room/hero.webp", width: 1920, height: 1080, alt },
    });
    expect(c.hero?.src).toBe("/salons/the-room/hero.webp");
  });

  it("rechaza una portada sin texto alternativo en algún idioma", () => {
    expect(() =>
      salonConfigSchema.parse({ ...bilingual, hero: { width: 1920, height: 1080, alt: { es: "El equipo" } } }),
    ).toThrow();
    expect(() =>
      salonConfigSchema.parse({ ...bilingual, hero: { width: 1920, height: 1080, alt: { es: "El equipo", en: " " } } }),
    ).toThrow();
  });

  it("rechaza medidas que no son positivas", () => {
    expect(() =>
      salonConfigSchema.parse({ ...bilingual, hero: { width: 0, height: 1080, alt } }),
    ).toThrow();
  });
});
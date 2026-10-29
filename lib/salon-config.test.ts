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

describe("enfoque de la portada", () => {
  const base = {
    ...valid,
    hero: { width: 1536, height: 1024, alt: { es: "El equipo" } },
  };

  it("sin focus no hay enfoque (recorte centrado)", () => {
    expect(salonConfigSchema.parse(base).hero?.focus).toBeUndefined();
  });

  it("acepta valores válidos de object-position", () => {
    for (const focus of ["center 15%", "left top", "50% 20%", "right bottom"]) {
      const c = salonConfigSchema.parse({ ...base, hero: { ...base.hero, focus } });
      expect(c.hero?.focus).toBe(focus);
    }
  });

  it("rechaza valores que no son object-position", () => {
    for (const focus of ["up", "center", "center; background:red", "150% 5%x", "", "center 15% extra"]) {
      expect(() =>
        salonConfigSchema.parse({ ...base, hero: { ...base.hero, focus } }),
      ).toThrow();
    }
  });
});

describe("imagen de portada para móvil", () => {
  const base = {
    ...valid,
    hero: { src: "/h.webp", width: 1536, height: 1024, alt: { es: "El equipo" } },
  };

  it("sin mobile no hay imagen alternativa", () => {
    expect(salonConfigSchema.parse(base).hero?.mobile).toBeUndefined();
  });

  it("acepta una imagen de móvil con medidas", () => {
    const c = salonConfigSchema.parse({
      ...base,
      hero: { ...base.hero, mobile: { src: "/m.webp", width: 900, height: 1350 } },
    });
    expect(c.hero?.mobile).toEqual({ src: "/m.webp", width: 900, height: 1350 });
  });

  it("rechaza una imagen de móvil sin medidas o con medidas no positivas", () => {
    expect(() =>
      salonConfigSchema.parse({ ...base, hero: { ...base.hero, mobile: { src: "/m.webp" } } }),
    ).toThrow();
    expect(() =>
      salonConfigSchema.parse({
        ...base,
        hero: { ...base.hero, mobile: { src: "/m.webp", width: 0, height: 1350 } },
      }),
    ).toThrow();
  });
});

describe("depósitos en la configuración", () => {
  it("el depósito guarda el hueco 24 horas por defecto y sin textos", () => {
    const c = salonConfigSchema.parse(valid);
    expect(c.booking.deposit.holdHours).toBe(24);
    expect(c.booking.deposit.instructions).toBeUndefined();
  });

  it("acepta un plazo de depósito propio", () => {
    const c = salonConfigSchema.parse({ ...valid, booking: { deposit: { holdHours: 12 } } });
    expect(c.booking.deposit.holdHours).toBe(12);
  });

  it("rechaza un plazo de depósito de cero horas", () => {
    expect(() =>
      salonConfigSchema.parse({ ...valid, booking: { deposit: { holdHours: 0 } } }),
    ).toThrow();
  });

  it("las instrucciones de pago tienen que estar en todos los idiomas", () => {
    const two = { ...valid, locales: ["es", "en"] };
    expect(() =>
      salonConfigSchema.parse({
        ...two,
        booking: { deposit: { instructions: { es: "Haz un Bizum" } } },
      }),
    ).toThrow(/Falta el texto en/);
    expect(() =>
      salonConfigSchema.parse({
        ...two,
        booking: { deposit: { instructions: { es: "Haz un Bizum", en: "Send a Bizum" } } },
      }),
    ).not.toThrow();
  });
});

describe("modo de pago del depósito", () => {
  it("por defecto se paga con instrucciones", () => {
    expect(salonConfigSchema.parse(valid).booking.deposit.mode).toBe("instructions");
  });

  it("admite pedir el enlace de pago por WhatsApp si hay número", () => {
    const c = salonConfigSchema.parse({
      ...valid,
      contact: { whatsapp: "34600000000" },
      booking: { deposit: { mode: "whatsapp" } },
    });
    expect(c.booking.deposit.mode).toBe("whatsapp");
  });

  it("el modo whatsapp sin número de WhatsApp es un error", () => {
    expect(() =>
      salonConfigSchema.parse({ ...valid, booking: { deposit: { mode: "whatsapp" } } }),
    ).toThrow(/falta contact\.whatsapp/);
  });

  it("rechaza un modo que no existe", () => {
    expect(() =>
      salonConfigSchema.parse({ ...valid, booking: { deposit: { mode: "paypal" } } }),
    ).toThrow();
  });
});

describe("prefijo telefónico", () => {
  it("por defecto es 34 y acepta otro", () => {
    expect(salonConfigSchema.parse(valid).phoneCountryCode).toBe("34");
    expect(salonConfigSchema.parse({ ...valid, phoneCountryCode: "351" }).phoneCountryCode).toBe("351");
  });
  it("rechaza un prefijo con + o letras", () => {
    expect(() => salonConfigSchema.parse({ ...valid, phoneCountryCode: "+34" })).toThrow();
    expect(() => salonConfigSchema.parse({ ...valid, phoneCountryCode: "es" })).toThrow();
  });
});

describe("salonConfigSchema · koibox", () => {
  const account = (keyEnv: string) => ({ label: "Cuenta", keyEnv });

  it("sin koibox, el salón no tiene cuentas", () => {
    expect(salonConfigSchema.parse(valid).koibox.accounts).toEqual({});
  });

  it("acepta cuentas con su variable de clave", () => {
    const c = salonConfigSchema.parse({
      ...valid,
      koibox: { accounts: { salon: account("KOIBOX_KEY_SALON"), amanda: account("KOIBOX_KEY_AMANDA") } },
    });
    expect(Object.keys(c.koibox.accounts)).toEqual(["salon", "amanda"]);
  });

  it("rechaza ids de cuenta raros y variables que no son KOIBOX_KEY_...", () => {
    expect(() => salonConfigSchema.parse({ ...valid, koibox: { accounts: { Salon: account("KOIBOX_KEY_SALON") } } })).toThrow();
    expect(() => salonConfigSchema.parse({ ...valid, koibox: { accounts: { salon: account("SECRET") } } })).toThrow();
  });

  it("rechaza dos cuentas con la misma clave", () => {
    expect(() =>
      salonConfigSchema.parse({
        ...valid,
        koibox: { accounts: { salon: account("KOIBOX_KEY_SALON"), amanda: account("KOIBOX_KEY_SALON") } },
      }),
    ).toThrow(/KOIBOX_KEY_SALON ya la usa la cuenta/);
  });
});

describe("config de The Room", () => {
  it("es válido y tiene una cuenta de Koibox por titular", async () => {
    const raw = (await import("../salons/the-room/config")).default;
    const c = salonConfigSchema.parse(raw);
    expect(Object.keys(c.koibox.accounts)).toEqual(["salon", "amanda", "luz"]);
  });
});
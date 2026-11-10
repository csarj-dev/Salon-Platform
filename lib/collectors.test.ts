import { describe, expect, it } from "vitest";
import {
  SINGLE_COLLECTOR_ID, chooseCollector, hasSeveralCollectors, isSalonCollector, resolveCollector, salonCollectors,
  staffCollectorView,
} from "./collectors";
import { salonConfigSchema } from "./salon-config";

const base = {
  name: "Salón de prueba",
  timezone: "Atlantic/Canary",
  locales: ["es"],
  defaultLocale: "es",
  contact: { whatsapp: "34600000000" },
  booking: {},
};

// Como The Room: un cobrador por titular, cada cuenta de Koibox con el suyo
const multi = salonConfigSchema.parse({
  ...base,
  payments: {
    defaultCollector: "salon",
    collectors: {
      salon: { label: "The Room Studio", deposit: { mode: "whatsapp" } },
      amanda: { label: "Amanda", deposit: { mode: "whatsapp", whatsapp: "+34 611 111 111" } },
      luz: { label: "Luz", deposit: { instructions: { es: "Bizum al 622 222 222" } } },
    },
  },
  koibox: {
    accounts: {
      salon: { label: "Salón", keyEnv: "KOIBOX_KEY_SALON" },
      amanda: { label: "Amanda", keyEnv: "KOIBOX_KEY_AMANDA", collector: "amanda" },
      luz: { label: "Luz", keyEnv: "KOIBOX_KEY_LUZ", collector: "luz" },
    },
  },
});

describe("salonCollectors", () => {
  it("sin payments: un solo cobrador, el salón, con instrucciones y su WhatsApp", () => {
    const c = salonConfigSchema.parse(base);
    const { defaultId, byId } = salonCollectors(c);
    expect(defaultId).toBe(SINGLE_COLLECTOR_ID);
    expect([...byId.values()]).toEqual([
      {
        id: SINGLE_COLLECTOR_ID,
        label: "Salón de prueba",
        deposit: { mode: "instructions", whatsapp: "34600000000", instructions: null },
      },
    ]);
    expect(hasSeveralCollectors(c)).toBe(false);
    expect(hasSeveralCollectors(multi)).toBe(true);
  });

  it("con un solo cobrador no hace falta defaultCollector", () => {
    const c = salonConfigSchema.parse({ ...base, payments: { collectors: { yo: { label: "Yo" } } } });
    expect(salonCollectors(c).defaultId).toBe("yo");
  });

  it("cada cobrador usa su WhatsApp o, si no tiene, el del salón", () => {
    const { byId } = salonCollectors(multi);
    expect(byId.get("amanda")?.deposit.whatsapp).toBe("34611111111");
    expect(byId.get("salon")?.deposit.whatsapp).toBe("34600000000");
    expect(byId.get("luz")?.deposit).toEqual({
      mode: "instructions",
      whatsapp: "34600000000",
      instructions: { es: "Bizum al 622 222 222" },
    });
  });
});

describe("resolveCollector", () => {
  it("de la profesional, si lo tiene", () => {
    expect(resolveCollector(multi, { staffCollector: "luz", koiboxAccount: "amanda" }).id).toBe("luz");
  });

  it("si no, el de su cuenta de Koibox", () => {
    expect(resolveCollector(multi, { koiboxAccount: "amanda" }).id).toBe("amanda");
  });

  it("si la cuenta no dice nada, o no hay cuenta, el de por defecto", () => {
    expect(resolveCollector(multi, { koiboxAccount: "salon" }).id).toBe("salon");
    expect(resolveCollector(multi, {}).id).toBe("salon");
    expect(resolveCollector(multi).id).toBe("salon");
  });

  it("un cobrador que ya no está en el config se salta", () => {
    expect(resolveCollector(multi, { staffCollector: "antigua", koiboxAccount: "luz" }).id).toBe("luz");
    expect(resolveCollector(multi, { koiboxAccount: "cuenta-borrada" }).id).toBe("salon");
  });
});

describe("chooseCollector", () => {
  it("dice de dónde sale el cobrador", () => {
    expect(chooseCollector(multi, { staffCollector: "luz" })).toMatchObject({ source: "staff", ignored: null });
    expect(chooseCollector(multi, { koiboxAccount: "amanda" })).toMatchObject({ source: "account", ignored: null });
    expect(chooseCollector(multi, { koiboxAccount: "salon" })).toMatchObject({ source: "default", ignored: null });
  });

  it("avisa del id guardado que ya no está en el config", () => {
    expect(chooseCollector(multi, { staffCollector: "antigua", koiboxAccount: "amanda" })).toMatchObject({
      collector: { id: "amanda" },
      source: "account",
      ignored: "antigua",
    });
  });
});

describe("salonConfigSchema · cobradores", () => {
  const collectors = { a: { label: "A" }, b: { label: "B" } };

  it("con varios hay que decir cuál cobra por defecto, y tiene que existir", () => {
    expect(() => salonConfigSchema.parse({ ...base, payments: { collectors } })).toThrow(/cobra por defecto/);
    expect(() => salonConfigSchema.parse({ ...base, payments: { defaultCollector: "c", collectors } })).toThrow(
      /no está en payments.collectors/,
    );
    expect(() => salonConfigSchema.parse({ ...base, payments: { defaultCollector: "a", collectors } })).not.toThrow();
  });

  it("la cuenta de Koibox tiene que apuntar a un cobrador que existe", () => {
    const koibox = { accounts: { amanda: { label: "Amanda", keyEnv: "KOIBOX_KEY_AMANDA", collector: "amanda" } } };
    expect(() => salonConfigSchema.parse({ ...base, koibox })).toThrow(/no está en payments.collectors/);
  });

  it("quien cobra por WhatsApp necesita número (el suyo o el del salón)", () => {
    const viaWhatsApp = { x: { label: "X", deposit: { mode: "whatsapp" } } };
    expect(() =>
      salonConfigSchema.parse({ ...base, contact: {}, payments: { collectors: viaWhatsApp } }),
    ).toThrow(/cobra por WhatsApp pero no tiene número/);
    expect(() => salonConfigSchema.parse({ ...base, payments: { collectors: viaWhatsApp } })).not.toThrow();
  });

  it("las instrucciones de cada cobrador, en todos los idiomas", () => {
    const two = { ...base, locales: ["es", "en"] };
    const only = { x: { label: "X", deposit: { instructions: { es: "Bizum" } } } };
    expect(() => salonConfigSchema.parse({ ...two, payments: { collectors: only } })).toThrow(/Falta el texto en/);
  });

  it("ids de cobrador en minúsculas", () => {
    expect(() => salonConfigSchema.parse({ ...base, payments: { collectors: { Amanda: { label: "A" } } } })).toThrow();
  });
});

describe("staffCollectorView", () => {
  it("con cobrador propio: cobra el suyo, y sin él cobraría el de su cuenta", () => {
    const v = staffCollectorView(multi, { staffCollector: "luz", koiboxAccount: "amanda" });
    expect(v.choice.collector.id).toBe("luz");
    expect(v.choice.source).toBe("staff");
    expect(v.fallback.id).toBe("amanda");
  });

  it("sin cuenta ni cobrador propio: el de por defecto en los dos casos", () => {
    const v = staffCollectorView(multi, {});
    expect(v.choice.source).toBe("default");
    expect(v.fallback.id).toBe("salon");
  });
});

describe("isSalonCollector", () => {
  it("solo los del config", () => {
    expect(isSalonCollector(multi, "amanda")).toBe(true);
    expect(isSalonCollector(multi, "nadie")).toBe(false);
  });
});
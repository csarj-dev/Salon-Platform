import "./test-env"; // tiene que ser el primer import
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, pgClient } from "../db";
import {
  appointment, client, koiboxServiceMap, location, locationService, schedule, service, staff, staffService, timeOff,
} from "../db/schema";
import {
  loadKoiboxOverview, loadServiceLinks, setServiceKoiboxLink, setStaffKoiboxLink,
} from "../lib/koibox-links-db";
import type { KoiboxConfig } from "../lib/salon-config";

const koibox: KoiboxConfig = {
  accounts: {
    salon: { label: "Salón", keyEnv: "KOIBOX_KEY_SALON" },
    amanda: { label: "Amanda", keyEnv: "KOIBOX_KEY_AMANDA" },
  },
};

let ids: { ana: number; lucia: number };

async function wipe() {
  await db.delete(appointment);
  await db.delete(timeOff);
  await db.delete(schedule);
  await db.delete(locationService);
  await db.delete(staffService);
  await db.delete(client);
  await db.delete(staff);
  await db.delete(service); // sus ids de Koibox caen en cascada
  await db.delete(location);
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
}, 30_000);

beforeEach(async () => {
  await wipe();
  const [ana, lucia] = await db
    .insert(staff)
    .values([{ name: "Ana", koiboxAccount: "salon", koiboxUserId: 11 }, { name: "Lucía" }])
    .returning();
  const [laminado, diseno] = await db
    .insert(service)
    .values([
      { name: "Laminado de cejas", durationMin: 60, priceCents: 4500 },
      { name: "Diseño de cejas", durationMin: 30, priceCents: 1800 },
    ])
    .returning();
  await db.insert(staffService).values([
    { staffId: ana.id, serviceId: laminado.id },
    { staffId: ana.id, serviceId: diseno.id },
    { staffId: lucia.id, serviceId: laminado.id },
  ]);
  await db.insert(koiboxServiceMap).values({ serviceId: laminado.id, account: "salon", koiboxServiceId: 501 });
  ids = { ana: ana.id, lucia: lucia.id };
});

afterAll(async () => {
  await wipe();
  await pgClient.end();
});

const linkOf = async (id: number) => {
  const [row] = await db.select().from(staff).where(eq(staff.id, id));
  return [row.koiboxAccount, row.koiboxUserId];
};

describe("resumen de Koibox para el panel", () => {
  it("cuenta enlaces por cuenta, dice qué clave falta y qué servicios faltan", async () => {
    const o = await loadKoiboxOverview({ koibox }, { KOIBOX_DRIVER: "api", KOIBOX_KEY_SALON: "x" });
    expect(o.accounts.map((a) => [a.id, a.key, a.staffCount, a.servicesLinked])).toEqual([
      ["salon", "ok", 1, 1],
      ["amanda", "missing", 0, 0],
    ]);
    expect(o.staff.map((s) => [s.staffName, s.account, s.missingServices])).toEqual([
      ["Ana", "salon", ["Diseño de cejas"]],
      ["Lucía", null, []],
    ]);
  });

  it("con el Koibox de mentira no pide claves", async () => {
    const o = await loadKoiboxOverview({ koibox }, { KOIBOX_DRIVER: "fake" });
    expect(o.accounts.every((a) => a.key === "fake")).toBe(true);
  });

  it("avisa de una cuenta que ya no está en el config", async () => {
    const o = await loadKoiboxOverview({ koibox: { accounts: { amanda: koibox.accounts.amanda } } }, {});
    expect(o.staff.find((s) => s.staffName === "Ana")).toMatchObject({ unknownAccount: true, missingServices: [] });
  });
});

describe("enlazar desde el panel", () => {
  it("enlaza, no deja repetir usuaria, y quita", async () => {
    expect(await setStaffKoiboxLink({ koibox }, ids.lucia, { account: "salon", userId: 12 })).toBe("ok");
    expect(await linkOf(ids.lucia)).toEqual(["salon", 12]);

    // La 11 ya es Ana
    expect(await setStaffKoiboxLink({ koibox }, ids.lucia, { account: "salon", userId: 11 })).toBe("userTaken");
    expect(await linkOf(ids.lucia)).toEqual(["salon", 12]);

    expect(await setStaffKoiboxLink({ koibox }, ids.lucia, { account: "nadie", userId: 1 })).toBe("unknownAccount");
    expect(await setStaffKoiboxLink({ koibox }, 999_999, { account: "salon", userId: 5 })).toBe("notFound");

    expect(await setStaffKoiboxLink({ koibox }, ids.lucia, null)).toBe("ok");
    expect(await linkOf(ids.lucia)).toEqual([null, null]);
  });
});

describe("servicios desde el panel", () => {
  const linksOf = async (serviceId: number) =>
    (await db.select().from(koiboxServiceMap).where(eq(koiboxServiceMap.serviceId, serviceId))).map((l) => [l.account, l.koiboxServiceId]);

  it("dice en cada cuenta su id y quién lo hace", async () => {
    const rows = await loadServiceLinks({ koibox });
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName["Laminado de cejas"].accounts).toEqual([
      { account: "salon", koiboxServiceId: 501, neededBy: ["Ana"] }, // Lucía no está enlazada: no cuenta
      { account: "amanda", koiboxServiceId: null, neededBy: [] },
    ]);
    expect(byName["Diseño de cejas"].accounts[0]).toEqual({ account: "salon", koiboxServiceId: null, neededBy: ["Ana"] });
  });

  it("pone, cambia y quita el id de un servicio en una cuenta", async () => {
    const [diseno] = await db.select().from(service).where(eq(service.name, "Diseño de cejas"));
    expect(await setServiceKoiboxLink({ koibox }, diseno.id, "salon", 502)).toBe("ok");
    expect(await setServiceKoiboxLink({ koibox }, diseno.id, "salon", 503)).toBe("ok");
    expect(await linksOf(diseno.id)).toEqual([["salon", 503]]);

    expect(await setServiceKoiboxLink({ koibox }, diseno.id, "nadie", 1)).toBe("unknownAccount");
    expect(await setServiceKoiboxLink({ koibox }, 999_999, "salon", 1)).toBe("notFound");

    expect(await setServiceKoiboxLink({ koibox }, diseno.id, "salon", null)).toBe("ok");
    expect(await linksOf(diseno.id)).toEqual([]);
  });
});
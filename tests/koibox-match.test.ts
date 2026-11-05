import "./test-env"; // tiene que ser el primer import
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { asc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, pgClient } from "../db";
import {
  appointment, client, koiboxServiceMap, location, locationService, schedule, service, staff, staffService, timeOff,
} from "../db/schema";
import { createKoiboxClient, type KoiboxApi } from "../lib/koibox/client";
import { createFakeKoibox } from "../lib/koibox/fake";
import { RateLimiter } from "../lib/koibox/limits";
import { applyKoiboxMatches, planKoiboxMatches } from "../lib/koibox-match-db";
import type { KoiboxConfig } from "../lib/salon-config";

const koibox: KoiboxConfig = {
  accounts: {
    salon: { label: "Salón", keyEnv: "KOIBOX_KEY_SALON" },
    amanda: { label: "Amanda", keyEnv: "KOIBOX_KEY_AMANDA" },
  },
};

let apis: Record<string, KoiboxApi>;
const apiFor = (account: string) => apis[account];

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
  await db.insert(staff).values([{ name: "Ana" }, { name: "Lucía" }, { name: "Amanda" }]);
  await db.insert(service).values([
    { name: "Laminado de cejas", durationMin: 60, priceCents: 4500 },
    { name: "Diseño de cejas", durationMin: 30, priceCents: 1800 },
    { name: "Lifting de pestañas", durationMin: 75, priceCents: 5500 },
  ]);
  const fake = createFakeKoibox({
    salon: {
      users: [{ id: 11, name: "Ana" }, { id: 12, name: "Lucía García" }],
      services: [
        { id: 501, name: "Laminado de Cejas", duration: "01:00:00", userIds: [11, 12] },
        { id: 502, name: "Diseño de cejas", duration: "00:45:00", userIds: [11] },
        { id: 503, name: "Tinte de pestañas", duration: "00:30:00", userIds: [12] },
      ],
    },
    amanda: {
      users: [{ id: 7, name: "Amanda" }],
      services: [{ id: 77, name: "Lifting pestañas", duration: "01:15:00", userIds: [7] }],
    },
  });
  const make = (key: string) => createKoiboxClient({ apiKey: key, fetchImpl: fake.fetch, limiter: new RateLimiter(1000) });
  apis = { salon: make("salon"), amanda: make("amanda") };
});

afterAll(async () => {
  await wipe();
  await pgClient.end();
});

const staffLinks = async () =>
  (await db.select().from(staff).orderBy(asc(staff.name))).map((s) => [s.name, s.koiboxAccount, s.koiboxUserId]);

describe("emparejar con Koibox", () => {
  it("propone por cuenta y guarda solo lo seguro", async () => {
    const plan = await planKoiboxMatches({ koibox }, apiFor);
    expect(plan.errors).toEqual([]);
    expect(plan.staff.link.map((l) => [l.ours.name, l.theirs.account, l.theirs.id])).toEqual([
      ["Amanda", "amanda", 7],
      ["Ana", "salon", 11],
    ]);
    expect(plan.staff.suggestions.map((s) => [s.ours.name, s.theirs.id])).toEqual([["Lucía", 12]]);

    const salon = plan.services.find((p) => p.account === "salon")!;
    expect(salon.link.map((l) => [l.ours.name, l.theirs.id])).toEqual([["Laminado de cejas", 501]]);
    expect(salon.doubtful.map((d) => d.ours.name)).toEqual(["Diseño de cejas"]); // 30 vs 45 min
    expect(salon.missingInCatalog.map((t) => t.nombre)).toEqual(["Tinte de pestañas"]);
    const amanda = plan.services.find((p) => p.account === "amanda")!;
    expect(amanda.suggestions.map((s) => [s.ours.name, s.theirs.id])).toEqual([["Lifting de pestañas", 77]]);

    expect(await applyKoiboxMatches(plan)).toEqual({ staffLinked: 2, servicesLinked: 1, skipped: [] });
    expect(await staffLinks()).toEqual([
      ["Amanda", "amanda", 7],
      ["Ana", "salon", 11],
      ["Lucía", null, null],
    ]);
    expect((await db.select().from(koiboxServiceMap)).map((l) => [l.account, l.koiboxServiceId])).toEqual([["salon", 501]]);

    // Una segunda pasada ya no propone lo enlazado
    const again = await planKoiboxMatches({ koibox }, apiFor);
    expect(again.staff.link).toEqual([]);
    expect(again.services.find((p) => p.account === "salon")!.alreadyLinked).toBe(1);
  });

  it("nunca pisa: si entretanto se enlazó a mano, lo deja como está", async () => {
    const plan = await planKoiboxMatches({ koibox }, apiFor);
    // Alguien enlaza a Ana a mano con otra usuaria antes de aplicar
    await db.update(staff).set({ koiboxAccount: "salon", koiboxUserId: 99 }).where(eq(staff.name, "Ana"));
    const r = await applyKoiboxMatches(plan);
    expect(r.staffLinked).toBe(1); // solo Amanda
    expect(r.skipped).toEqual(["Ana: ya tenía cuenta de Koibox"]);
    expect((await staffLinks()).find((s) => s[0] === "Ana")).toEqual(["Ana", "salon", 99]);
  });

  it("si una cuenta no responde, enseña las demás", async () => {
    apis.amanda = createKoiboxClient({
      apiKey: "amanda",
      fetchImpl: async () => new Response(JSON.stringify({ detail: "Clave no válida" }), { status: 403 }),
      limiter: new RateLimiter(1000),
    });
    const plan = await planKoiboxMatches({ koibox }, apiFor);
    expect(plan.errors.map((e) => e.account)).toEqual(["amanda"]);
    expect(plan.services.map((p) => p.account)).toEqual(["salon"]);
  });
});
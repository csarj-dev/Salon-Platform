import "./test-env"; // tiene que ser el primer import
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, pgClient } from "../db";
import { koiboxServiceMap, service, staff } from "../db/schema";

const NAME = "Koibox link test";

let ana: number;
let bea: number;
let svc: number;

async function cleanup() {
  await db.delete(staff).where(eq(staff.name, NAME));
  await db.delete(service).where(eq(service.name, NAME)); // los ids de Koibox caen en cascada
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await cleanup();
  const rows = await db.insert(staff).values([{ name: NAME }, { name: NAME }]).returning();
  [ana, bea] = rows.map((r) => r.id);
  const [s] = await db.insert(service).values({ name: NAME, durationMin: 60, priceCents: 4500 }).returning();
  svc = s.id;
});

afterAll(async () => {
  await cleanup();
  await pgClient.end();
});

describe("enlace de profesionales con Koibox", () => {
  it("guarda la cuenta y la usuaria de Koibox", async () => {
    await db.update(staff).set({ koiboxAccount: "salon", koiboxUserId: 11 }).where(eq(staff.id, ana));
    const [row] = await db.select().from(staff).where(eq(staff.id, ana));
    expect(row).toMatchObject({ koiboxAccount: "salon", koiboxUserId: 11 });
  });

  it("no admite cuenta sin usuaria ni usuaria sin cuenta", async () => {
    await expect(db.update(staff).set({ koiboxAccount: "salon", koiboxUserId: null }).where(eq(staff.id, bea))).rejects.toThrow();
    await expect(db.update(staff).set({ koiboxAccount: null, koiboxUserId: 12 }).where(eq(staff.id, bea))).rejects.toThrow();
  });

  it("no admite ids de cuenta raros", async () => {
    await expect(db.update(staff).set({ koiboxAccount: "Salón", koiboxUserId: 12 }).where(eq(staff.id, bea))).rejects.toThrow();
  });

  it("una usuaria de Koibox no se puede enlazar a dos profesionales de la misma cuenta", async () => {
    await expect(db.update(staff).set({ koiboxAccount: "salon", koiboxUserId: 11 }).where(eq(staff.id, bea))).rejects.toThrow();
    // El mismo número en otra cuenta es otra persona
    await db.update(staff).set({ koiboxAccount: "amanda", koiboxUserId: 11 }).where(eq(staff.id, bea));
  });

  it("varias profesionales sin enlazar no chocan entre sí", async () => {
    await db.update(staff).set({ koiboxAccount: null, koiboxUserId: null }).where(inArray(staff.id, [ana, bea]));
    const rows = await db.select().from(staff).where(inArray(staff.id, [ana, bea]));
    expect(rows.every((r) => r.koiboxAccount === null)).toBe(true);
  });
});

describe("ids de servicio por cuenta", () => {
  it("un servicio tiene un id distinto en cada cuenta y se puede cambiar", async () => {
    await db.insert(koiboxServiceMap).values([
      { serviceId: svc, account: "salon", koiboxServiceId: 501 },
      { serviceId: svc, account: "amanda", koiboxServiceId: 77 },
    ]);
    await db
      .insert(koiboxServiceMap)
      .values({ serviceId: svc, account: "salon", koiboxServiceId: 502 })
      .onConflictDoUpdate({ target: [koiboxServiceMap.serviceId, koiboxServiceMap.account], set: { koiboxServiceId: 502 } });
    const rows = await db.select().from(koiboxServiceMap).where(eq(koiboxServiceMap.serviceId, svc));
    expect(rows.map((r) => `${r.account}:${r.koiboxServiceId}`).sort()).toEqual(["amanda:77", "salon:502"]);
  });

  it("rechaza ids de Koibox no positivos", async () => {
    await expect(
      db.insert(koiboxServiceMap).values({ serviceId: svc, account: "luz", koiboxServiceId: 0 }),
    ).rejects.toThrow();
  });

  it("al borrar el servicio se borran sus ids de Koibox", async () => {
    await db.delete(service).where(eq(service.id, svc));
    const rows = await db
      .select()
      .from(koiboxServiceMap)
      .where(and(eq(koiboxServiceMap.serviceId, svc), eq(koiboxServiceMap.account, "salon")));
    expect(rows).toHaveLength(0);
  });
});
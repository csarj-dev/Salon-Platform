import "./test-env"; // tiene que ser el primer import
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, pgClient } from "../db";
import {
  location, locationHours, service, serviceCategory,
} from "../db/schema";
import { pgErrorCode } from "../lib/booking";

// Para limpiar al final sin tocar los datos de otros tests
const locationIds: number[] = [];
const serviceIds: number[] = [];
const categoryIds: number[] = [];

let locationId: number;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  const [l] = await db.insert(location).values({ name: "Showcase test" }).returning();
  locationId = l.id;
  locationIds.push(l.id);
}, 30_000);

afterAll(async () => {
  for (const id of serviceIds) await db.delete(service).where(eq(service.id, id));
  for (const id of categoryIds) await db.delete(serviceCategory).where(eq(serviceCategory.id, id));
  for (const id of locationIds) await db.delete(location).where(eq(location.id, id));
  await pgClient.end();
});

describe("esquema del escaparate", () => {
  it("rechaza un horario que cierra antes de abrir", async () => {
    const insert = db
      .insert(locationHours)
      .values({ locationId, weekday: 1, openTime: "18:00", closeTime: "09:00" });
    await expect(insert).rejects.toSatisfy((e) => pgErrorCode(e) === "23514");
  });

  it("rechaza un día de la semana fuera de 1 a 7", async () => {
    const insert = db
      .insert(locationHours)
      .values({ locationId, weekday: 8, openTime: "09:00", closeTime: "18:00" });
    await expect(insert).rejects.toSatisfy((e) => pgErrorCode(e) === "23514");
  });

  it("acepta un día con turno partido (dos filas)", async () => {
    await db.insert(locationHours).values([
      { locationId, weekday: 2, openTime: "10:00", closeTime: "14:00" },
      { locationId, weekday: 2, openTime: "16:00", closeTime: "20:00" },
    ]);
    const rows = await db
      .select()
      .from(locationHours)
      .where(eq(locationHours.locationId, locationId));
    expect(rows.filter((r) => r.weekday === 2)).toHaveLength(2);
  });

  it("un servicio nuevo no requiere consulta y no tiene categoría", async () => {
    const [s] = await db
      .insert(service)
      .values({ name: "Servicio test", durationMin: 30, priceCents: 1000 })
      .returning();
    serviceIds.push(s.id);
    expect(s.requiresConsultation).toBe(false);
    expect(s.categoryId).toBeNull();
    expect(s.sortOrder).toBe(0);
  });

  it("borrar una categoría deja el servicio sin categoría, no lo borra", async () => {
    const [c] = await db.insert(serviceCategory).values({ name: "Cat test" }).returning();
    categoryIds.push(c.id);
    const [s] = await db
      .insert(service)
      .values({ name: "Servicio con categoría", durationMin: 30, priceCents: 1000, categoryId: c.id })
      .returning();
    serviceIds.push(s.id);

    await db.delete(serviceCategory).where(eq(serviceCategory.id, c.id));

    const [after] = await db.select().from(service).where(eq(service.id, s.id));
    expect(after).toBeDefined();
    expect(after.categoryId).toBeNull();
  });

  it("borrar un local borra su horario de apertura", async () => {
    const [l] = await db.insert(location).values({ name: "Local temporal" }).returning();
    locationIds.push(l.id);
    await db
      .insert(locationHours)
      .values({ locationId: l.id, weekday: 1, openTime: "09:00", closeTime: "18:00" });

    await db.delete(location).where(eq(location.id, l.id));

    const rows = await db.select().from(locationHours).where(eq(locationHours.locationId, l.id));
    expect(rows).toEqual([]);
  });
});
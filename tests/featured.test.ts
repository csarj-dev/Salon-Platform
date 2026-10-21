import "./test-env"; // tiene que ser el primer import
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, pgClient } from "../db";
import { location, locationService, service, serviceTranslation } from "../db/schema";
import { listFeaturedServices } from "../lib/catalog";

const serviceIds: number[] = [];
const locationIds: number[] = [];
let laminadoId: number;
let liftingId: number;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });

  const [a, b, inactive] = await db
    .insert(location)
    .values([
      { name: "Featured A" },
      { name: "Featured B" },
      { name: "Featured inactivo", active: false },
    ])
    .returning();
  locationIds.push(a.id, b.id, inactive.id);

  const [lam, lif, hidden, onlyInactive] = await db
    .insert(service)
    .values([
      { name: "Laminado (interno)", durationMin: 60, priceCents: 4500, sortOrder: 2, featured: true },
      { name: "Lifting (interno)", durationMin: 75, priceCents: 5500, sortOrder: 1, featured: true },
      { name: "No destacado", durationMin: 30, priceCents: 1000, featured: false },
      { name: "Solo en local inactivo", durationMin: 30, priceCents: 1000, featured: true },
    ])
    .returning();
  serviceIds.push(lam.id, lif.id, hidden.id, onlyInactive.id);
  laminadoId = lam.id;
  liftingId = lif.id;

  await db.insert(serviceTranslation).values([
    { serviceId: lif.id, locale: "es", name: "Lifting", description: "Mirada abierta" },
    { serviceId: lif.id, locale: "en", name: "Lash lift", description: null },
    { serviceId: lam.id, locale: "es", name: "Laminado", description: null }, // sin inglés
  ]);

  // El laminado se ofrece en dos locales: debe salir una sola vez
  await db.insert(locationService).values([
    { locationId: a.id, serviceId: lam.id },
    { locationId: b.id, serviceId: lam.id },
    { locationId: a.id, serviceId: lif.id },
    { locationId: a.id, serviceId: hidden.id },
    { locationId: inactive.id, serviceId: onlyInactive.id },
  ]);
}, 30_000);

afterAll(async () => {
  await db.delete(locationService).where(inArray(locationService.serviceId, serviceIds));
  await db.delete(service).where(inArray(service.id, serviceIds));
  await db.delete(location).where(inArray(location.id, locationIds));
  await pgClient.end();
});

describe("servicios destacados", () => {
  it("solo los destacados de locales activos, una vez cada uno y por sort_order", async () => {
    const r = await listFeaturedServices("es", "es");
    expect(r.map((s) => s.id)).toEqual([liftingId, laminadoId]);
  });

  it("traduce y cae al idioma por defecto si falta la traducción", async () => {
    const es = await listFeaturedServices("es", "es");
    expect(es.map((s) => s.name)).toEqual(["Lifting", "Laminado"]);

    const en = await listFeaturedServices("en", "es");
    expect(en.map((s) => s.name)).toEqual(["Lash lift", "Laminado"]);
  });

  it("respeta el límite", async () => {
    const r = await listFeaturedServices("es", "es", 1);
    expect(r.map((s) => s.id)).toEqual([liftingId]);
  });
});
import "./test-env"; // tiene que ser el primer import
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, pgClient } from "../db";
import {
  appointment, client, location, locationHours, locationService, schedule,
  service, serviceCategory, serviceCategoryTranslation, serviceTranslation,
  staff, staffService, timeOff,
} from "../db/schema";
import {
  listActiveLocations, listLocationsWithHours, listServicesByCategory,
  listServicesForLocation, listStaffForService,
} from "../lib/catalog";

let centroId: number;
let surId: number;
let laminadoId: number;
let liftingId: number;
let extraId: number;
let anaId: number;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });

  await db.delete(appointment);
  await db.delete(timeOff);
  await db.delete(schedule);
  await db.delete(locationService);
  await db.delete(staffService);
  await db.delete(client);
  await db.delete(staff);
  await db.delete(serviceTranslation);
  await db.delete(service);
  await db.delete(serviceCategoryTranslation);
  await db.delete(serviceCategory);
  await db.delete(locationHours);
  await db.delete(location);

  const [centro, sur, cerrado] = await db
    .insert(location)
    .values([
      { name: "Centro", mapsUrl: "https://maps.example/centro" },
      { name: "Sur" },
      { name: "Cerrado", active: false },
    ])
    .returning();
  centroId = centro.id;
  surId = sur.id;
  void cerrado;

  // Horario del Centro con turno partido el lunes. Sur no tiene horario.
  await db.insert(locationHours).values([
    { locationId: centroId, weekday: 1, openTime: "16:00", closeTime: "20:00" },
    { locationId: centroId, weekday: 1, openTime: "09:00", closeTime: "14:00" },
    { locationId: cerrado.id, weekday: 1, openTime: "09:00", closeTime: "14:00" },
  ]);

  // Orden por sort_order, no alfabético: Pestañas (1) va antes que Cejas (2)
  const [cejas, pestanas] = await db
    .insert(serviceCategory)
    .values([
      { name: "Cejas (interno)", sortOrder: 2 },
      { name: "Pestañas (interno)", sortOrder: 1 },
    ])
    .returning();
  await db.insert(serviceCategoryTranslation).values([
    { categoryId: cejas.id, locale: "es", name: "Cejas" },
    { categoryId: cejas.id, locale: "en", name: "Brows" },
    { categoryId: pestanas.id, locale: "es", name: "Pestañas" }, // sin inglés a propósito
  ]);

  const [lam, lif, extra] = await db
    .insert(service)
    .values([
      { name: "Laminado (interno)", durationMin: 60, priceCents: 4500, categoryId: cejas.id },
      { name: "Lifting (interno)", durationMin: 75, priceCents: 5500, categoryId: pestanas.id, requiresConsultation: true },
      { name: "Extra (interno)", durationMin: 15, priceCents: 500 }, // sin categoría
    ])
    .returning();
  laminadoId = lam.id;
  liftingId = lif.id;
  extraId = extra.id;

  await db.insert(serviceTranslation).values([
    { serviceId: lam.id, locale: "es", name: "Laminado de cejas", description: "Descripción" },
    { serviceId: lam.id, locale: "en", name: "Brow lamination", description: null },
  ]);

  // Centro ofrece los tres; Sur solo el laminado, con precio propio
  await db.insert(locationService).values([
    { locationId: centroId, serviceId: lam.id },
    { locationId: centroId, serviceId: lif.id },
    { locationId: centroId, serviceId: extra.id },
    { locationId: surId, serviceId: lam.id, priceCents: 4000 },
  ]);

  const [ana, lucia] = await db
    .insert(staff)
    .values([{ name: "Ana" }, { name: "Lucía", active: false }])
    .returning();
  anaId = ana.id;

  await db.insert(staffService).values([
    { staffId: ana.id, serviceId: lam.id },
    { staffId: lucia.id, serviceId: lam.id },
  ]);
  // Ana trabaja en Centro; Lucía (inactiva) también
  await db.insert(schedule).values([
    { staffId: ana.id, locationId: centroId, weekday: 1, startTime: "10:00", endTime: "14:00" },
    { staffId: ana.id, locationId: centroId, weekday: 1, startTime: "16:00", endTime: "20:00" },
    { staffId: lucia.id, locationId: centroId, weekday: 1, startTime: "10:00", endTime: "14:00" },
  ]);
}, 30_000);

afterAll(async () => {
  await pgClient.end();
});

describe("catálogo", () => {
  it("lista solo los locales activos", async () => {
    const r = await listActiveLocations();
    expect(r.map((l) => l.name)).toEqual(["Centro", "Sur"]);
  });

  it("lista los servicios de un local en el idioma pedido", async () => {
    const es = await listServicesForLocation(centroId, "es", "es");
    expect(es.find((s) => s.id === laminadoId)?.name).toBe("Laminado de cejas");

    const en = await listServicesForLocation(centroId, "en", "es");
    expect(en.find((s) => s.id === laminadoId)?.name).toBe("Brow lamination");
  });

  it("usa el nombre interno si el servicio no tiene traducciones", async () => {
    const r = await listServicesForLocation(centroId, "en", "es");
    expect(r.find((s) => s.id === liftingId)?.name).toBe("Lifting (interno)");
  });

  it("solo devuelve los servicios que ofrece el local", async () => {
    const r = await listServicesForLocation(surId, "es", "es");
    expect(r.map((s) => s.id)).toEqual([laminadoId]);
  });

  it("aplica el precio propio del local si existe", async () => {
    const centro = await listServicesForLocation(centroId, "es", "es");
    const sur = await listServicesForLocation(surId, "es", "es");
    expect(centro.find((s) => s.id === laminadoId)?.priceCents).toBe(4500);
    expect(sur.find((s) => s.id === laminadoId)?.priceCents).toBe(4000);
  });

  it("indica qué servicios requieren consulta previa", async () => {
    const r = await listServicesForLocation(centroId, "es", "es");
    expect(r.find((s) => s.id === liftingId)?.requiresConsultation).toBe(true);
    expect(r.find((s) => s.id === laminadoId)?.requiresConsultation).toBe(false);
  });

  it("lista una sola vez a las profesionales activas del local", async () => {
    const r = await listStaffForService(centroId, laminadoId);
    expect(r.map((s) => s.id)).toEqual([anaId]); // Ana tiene dos turnos, sale una vez
  });

  it("no lista profesionales que no trabajan en ese local", async () => {
    const r = await listStaffForService(surId, laminadoId);
    expect(r).toEqual([]);
  });
});

describe("carta por categorías", () => {
  it("agrupa por categoría, ordena por sort_order y deja las sin categoría al final", async () => {
    const groups = await listServicesByCategory(centroId, "es", "es");
    expect(groups.map((g) => g.name)).toEqual(["Pestañas", "Cejas", null]);
    expect(groups[0].services.map((s) => s.id)).toEqual([liftingId]);
    expect(groups[1].services.map((s) => s.id)).toEqual([laminadoId]);
    expect(groups[2].services.map((s) => s.id)).toEqual([extraId]);
  });

  it("traduce las categorías y cae al idioma por defecto si falta la traducción", async () => {
    const groups = await listServicesByCategory(centroId, "en", "es");
    expect(groups.map((g) => g.name)).toEqual(["Pestañas", "Brows", null]);
  });

  it("no devuelve categorías sin servicios en ese local", async () => {
    const groups = await listServicesByCategory(surId, "es", "es");
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("Cejas");
  });
});

describe("locales con horario", () => {
  it("devuelve el horario ordenado, la URL del mapa y excluye los locales inactivos", async () => {
    const r = await listLocationsWithHours();
    expect(r.map((l) => l.name)).toEqual(["Centro", "Sur"]);

    const centro = r.find((l) => l.id === centroId)!;
    expect(centro.mapsUrl).toBe("https://maps.example/centro");
    expect(centro.hours.map((h) => h.openTime.slice(0, 5))).toEqual(["09:00", "16:00"]);
  });

  it("un local sin horario devuelve una lista vacía", async () => {
    const r = await listLocationsWithHours();
    expect(r.find((l) => l.id === surId)!.hours).toEqual([]);
  });
});
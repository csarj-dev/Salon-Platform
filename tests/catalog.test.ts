import "./test-env"; // tiene que ser el primer import
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, pgClient } from "../db";
import {
  appointment, client, location, locationService, schedule,
  service, serviceTranslation, staff, staffService, timeOff,
} from "../db/schema";
import {
  listActiveLocations, listServicesForLocation, listStaffForService,
} from "../lib/catalog";

let centroId: number;
let surId: number;
let laminadoId: number;
let liftingId: number;
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
  await db.delete(location);

  const [centro, sur, cerrado] = await db
    .insert(location)
    .values([
      { name: "Centro" },
      { name: "Sur" },
      { name: "Cerrado", active: false },
    ])
    .returning();
  centroId = centro.id;
  surId = sur.id;
  void cerrado;

  const [lam, lif] = await db
    .insert(service)
    .values([
      { name: "Laminado (interno)", durationMin: 60, priceCents: 4500 },
      { name: "Lifting (interno)", durationMin: 75, priceCents: 5500 },
    ])
    .returning();
  laminadoId = lam.id;
  liftingId = lif.id;

  await db.insert(serviceTranslation).values([
    { serviceId: lam.id, locale: "es", name: "Laminado de cejas", description: "Descripción" },
    { serviceId: lam.id, locale: "en", name: "Brow lamination", description: null },
  ]);

  // Centro ofrece los dos; Sur solo el laminado, con precio propio
  await db.insert(locationService).values([
    { locationId: centroId, serviceId: lam.id },
    { locationId: centroId, serviceId: lif.id },
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

  it("lista una sola vez a las profesionales activas del local", async () => {
    const r = await listStaffForService(centroId, laminadoId);
    expect(r.map((s) => s.id)).toEqual([anaId]); // Ana tiene dos turnos, sale una vez
  });

  it("no lista profesionales que no trabajan en ese local", async () => {
    const r = await listStaffForService(surId, laminadoId);
    expect(r).toEqual([]);
  });
});
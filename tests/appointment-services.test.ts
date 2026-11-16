import "./test-env"; // tiene que ser el primer import
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, pgClient } from "../db";
import {
  appointment, appointmentService, client, location, locationService, schedule, service,
  serviceTranslation, staff, staffService, timeOff,
} from "../db/schema";
import { serviceNamesFor } from "../lib/appointment-services";
import { listAppointments } from "../lib/appointment-list";

let combined: number; // laminado + diseño (guardados al revés para comprobar el orden)
let single: number; // sin líneas: solo su servicio principal

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  // Como en los demás tests de base de datos: cada archivo empieza de cero
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

  const [loc] = await db.insert(location).values({ name: "Local" }).returning();
  const [lam, dis] = await db
    .insert(service)
    .values([
      { name: "Laminado de cejas", durationMin: 60, priceCents: 4500 },
      { name: "Diseño de cejas", durationMin: 30, priceCents: 2000 },
    ])
    .returning();
  // Solo el laminado tiene nombre en inglés
  await db.insert(serviceTranslation).values({ serviceId: lam.id, locale: "en", name: "Brow lamination" });
  const [st] = await db.insert(staff).values({ name: "Profesional" }).returning();
  const [cl] = await db.insert(client).values({ name: "Carmen Vidal", phone: "622111222" }).returning();

  const base = {
    clientId: cl.id,
    clientName: "Carmen Vidal",
    serviceId: lam.id,
    staffId: st.id,
    locationId: loc.id,
    priceAppliedCents: 6500,
    source: "phone" as const,
  };
  const [a] = await db
    .insert(appointment)
    .values({ ...base, startsAt: new Date("2026-11-20T10:00:00Z"), endsAt: new Date("2026-11-20T11:20:00Z") })
    .returning({ id: appointment.id });
  const [b] = await db
    .insert(appointment)
    .values({ ...base, startsAt: new Date("2026-11-20T12:00:00Z"), endsAt: new Date("2026-11-20T13:00:00Z") })
    .returning({ id: appointment.id });
  combined = a.id;
  single = b.id;

  await db.insert(appointmentService).values([
    { appointmentId: combined, position: 1, serviceId: dis.id, durationMin: 30, priceCents: 2000 },
    { appointmentId: combined, position: 0, serviceId: lam.id, durationMin: 60, priceCents: 4500 },
  ]);
});

afterAll(async () => {
  await pgClient.end();
});

describe("serviceNamesFor", () => {
  it("los servicios de cada cita, en el orden en que se hacen", async () => {
    const names = await serviceNamesFor([combined, single]);
    expect(names.get(combined)).toEqual(["Laminado de cejas", "Diseño de cejas"]);
    // Sin líneas no aparece: quien llama usa su servicio principal
    expect(names.has(single)).toBe(false);
  });

  it("con idioma, traducidos; sin traducción, el nombre interno", async () => {
    const names = await serviceNamesFor([combined], { locale: "en", defaultLocale: "es" });
    expect(names.get(combined)).toEqual(["Brow lamination", "Diseño de cejas"]);
  });

  it("sin citas no consulta nada", async () => {
    expect((await serviceNamesFor([])).size).toBe(0);
  });
});

describe("listAppointments con varios servicios", () => {
  it("une los servicios en serviceName; la cita sin líneas se queda con el principal", async () => {
    const rows = await listAppointments({ statuses: ["booked"], order: "asc" });
    const byId = new Map(rows.map((r) => [r.id, r.serviceName]));
    expect(byId.get(combined)).toBe("Laminado de cejas + Diseño de cejas");
    expect(byId.get(single)).toBe("Laminado de cejas");
  });
});
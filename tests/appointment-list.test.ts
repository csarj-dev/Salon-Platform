import "./test-env"; // tiene que ser el primer import
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, pgClient } from "../db";
import {
  appointment, client, location, locationService, schedule, service, staff, staffService, timeOff,
} from "../db/schema";
import {
  appointmentSummary, clientSummary, listAppointments, type AppointmentStatus,
} from "../lib/appointment-list";

const ALL: AppointmentStatus[] = ["booked", "pending_deposit", "completed", "cancelled", "no_show", "expired"];

let svc: number;
let staffA: number;
let staffB: number;
let loc1: number;
let loc2: number;
let lucia: { id: number; name: string };
let marta: { id: number; name: string };
const ids: Record<string, number> = {};

async function add(
  key: string,
  o: {
    who: { id: number; name: string };
    staffId: number;
    locationId: number;
    startsAt: string;
    status?: AppointmentStatus;
    dueAt?: string; // con depósito pendiente
  },
) {
  const startsAt = new Date(o.startsAt);
  const [row] = await db
    .insert(appointment)
    .values({
      clientId: o.who.id,
      clientName: o.who.name,
      serviceId: svc,
      staffId: o.staffId,
      locationId: o.locationId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3_600_000),
      status: o.status ?? "booked",
      priceAppliedCents: 3000,
      source: "web",
      ...(o.dueAt ? { depositCents: 1500, depositDueAt: new Date(o.dueAt) } : {}),
    })
    .returning({ id: appointment.id });
  ids[key] = row.id;
}

// Los ids de las citas que devuelve la lista con estas opciones (de la más antigua a la más nueva)
const find = async (o: Partial<Parameters<typeof listAppointments>[0]>) =>
  (await listAppointments({ statuses: ALL, order: "asc", ...o })).map((r) => r.id);

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
  await db.delete(service);
  await db.delete(location);

  const [l1, l2] = await db.insert(location).values([{ name: "Local uno" }, { name: "Local dos" }]).returning();
  const [s] = await db.insert(service).values({ name: "Servicio", durationMin: 60, priceCents: 3000 }).returning();
  const [a, b] = await db.insert(staff).values([{ name: "Profesional A" }, { name: "Profesional B" }]).returning();
  const [c1, c2] = await db
    .insert(client)
    .values([
      { name: "Lucía Pérez", phone: "611 222 333" },
      { name: "Marta Gómez", phone: "+34 622 444 555" },
    ])
    .returning();
  svc = s.id;
  staffA = a.id;
  staffB = b.id;
  loc1 = l1.id;
  loc2 = l2.id;
  lucia = { id: c1.id, name: c1.name };
  marta = { id: c2.id, name: c2.name };

  await add("hoy10", { who: lucia, staffId: staffA, locationId: loc1, startsAt: "2026-12-01T10:00:00Z" });
  await add("hoy12", {
    who: marta, staffId: staffB, locationId: loc2, startsAt: "2026-12-01T12:00:00Z",
    status: "pending_deposit", dueAt: "2026-12-01T09:30:00Z",
  });
  await add("dia3", { who: lucia, staffId: staffA, locationId: loc1, startsAt: "2026-12-03T10:00:00Z" });
  await add("dia20", {
    who: marta, staffId: staffA, locationId: loc1, startsAt: "2026-12-20T10:00:00Z",
    status: "pending_deposit", dueAt: "2026-12-02T10:00:00Z",
  });
  await add("cancelada", { who: lucia, staffId: staffB, locationId: loc2, startsAt: "2026-11-20T10:00:00Z", status: "cancelled" });
  await add("noVino", { who: lucia, staffId: staffA, locationId: loc1, startsAt: "2026-11-10T10:00:00Z", status: "no_show" });
}, 30_000);

afterAll(async () => {
  await pgClient.end();
});

describe("buscar citas", () => {
  it("por nombre, sin importar tildes ni mayúsculas", async () => {
    const expected = [ids.noVino, ids.cancelada, ids.hoy10, ids.dia3];
    expect(await find({ search: "lucia" })).toEqual(expected);
    expect(await find({ search: "  PÉREZ " })).toEqual(expected);
  });

  it("por teléfono, comparando solo las cifras", async () => {
    expect(await find({ search: "622 444" })).toEqual([ids.hoy12, ids.dia20]);
    expect(await find({ search: "+34622" })).toEqual([ids.hoy12, ids.dia20]);
  });

  it("por número de cita, con o sin #", async () => {
    expect(await find({ search: `#${ids.dia3}` })).toContain(ids.dia3);
    expect(await find({ search: String(ids.dia3) })).toContain(ids.dia3);
  });

  it("% y _ se buscan tal cual, no como comodines", async () => {
    expect(await find({ search: "%" })).toEqual([]);
    expect(await find({ search: "_" })).toEqual([]);
  });

  it("sin texto, no filtra", async () => {
    expect(await find({ search: "   " })).toHaveLength(6);
  });
});

describe("filtrar citas", () => {
  it("por profesional, por local y por clienta", async () => {
    expect(await find({ staffId: staffB })).toEqual([ids.cancelada, ids.hoy12]);
    expect(await find({ locationId: loc1, from: new Date("2026-12-01T00:00:00Z") })).toEqual([
      ids.hoy10, ids.dia3, ids.dia20,
    ]);
    expect(await find({ clientId: marta.id })).toEqual([ids.hoy12, ids.dia20]);
  });

  it("cada fila trae la clienta y su correo", async () => {
    const [row] = await listAppointments({ statuses: ALL, order: "asc", clientId: lucia.id, limit: 1 });
    expect(row).toMatchObject({ clientId: lucia.id, clientName: "Lucía Pérez", clientEmail: null, hasEmail: false });
  });
});

describe("resumen de Citas", () => {
  it("cuenta hoy, los depósitos pendientes, los que vencen pronto y la semana", async () => {
    const s = await appointmentSummary({
      dayStart: new Date("2026-12-01T00:00:00Z"),
      dayEnd: new Date("2026-12-02T00:00:00Z"),
      weekEnd: new Date("2026-12-08T00:00:00Z"),
      soon: new Date("2026-12-01T10:00:00Z"),
    });
    expect(s).toEqual({
      today: 2,
      todayFirst: new Date("2026-12-01T10:00:00Z"),
      todayLast: new Date("2026-12-01T12:00:00Z"),
      pendingDeposits: 2,
      depositsDueSoon: 1,
      week: 3,
    });
  });
});

describe("ficha de la clienta", () => {
  it("cuenta sus citas y dice cuándo fue la primera", async () => {
    expect(await clientSummary(lucia.id, new Date("2026-12-01T08:00:00Z"))).toEqual({
      id: lucia.id,
      name: "Lucía Pérez",
      phone: "611 222 333",
      email: null,
      total: 4,
      upcoming: 2,
      cancelled: 1,
      noShow: 1,
      firstAt: new Date("2026-11-10T10:00:00Z"),
    });
  });

  it("una clienta que no existe da null", async () => {
    expect(await clientSummary(999_999_999, new Date())).toBeNull();
  });
});
import "./test-env"; // tiene que ser el primer import
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, pgClient } from "../db";
import {
  appointment, client, location, locationService, schedule, service, staff, staffService, timeOff,
} from "../db/schema";
import { loadAgendaColumns } from "../lib/agenda-db";
import { eq } from "drizzle-orm";

const ZONE = "Atlantic/Canary"; // en noviembre, igual que UTC
const MONDAY = "2026-11-16";

let loc1: number;
let loc2: number;
let ana: number;
let bea: number;
let carla: number;

const names = (cols: { staffName: string }[]) => cols.map((c) => c.staffName);

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
  const [a, b, c] = await db
    .insert(staff)
    .values([{ name: "Ana" }, { name: "Bea" }, { name: "Carla" }])
    .returning();
  loc1 = l1.id;
  loc2 = l2.id;
  ana = a.id;
  bea = b.id;
  carla = c.id;

  await db.insert(schedule).values([
    // Ana: lunes en el local uno con turno partido; miércoles en el local dos
    { staffId: ana, locationId: loc1, weekday: 1, startTime: "16:00", endTime: "20:00" },
    { staffId: ana, locationId: loc1, weekday: 1, startTime: "09:30", endTime: "14:00" },
    { staffId: ana, locationId: loc2, weekday: 3, startTime: "10:00", endTime: "18:00" },
    // Bea: solo martes en el local uno
    { staffId: bea, locationId: loc1, weekday: 2, startTime: "10:00", endTime: "18:00" },
    // Carla: sin horario
  ]);

  await db.insert(timeOff).values([
    // Ana sale una hora el lunes
    { staffId: ana, startsAt: new Date("2026-11-16T10:00:00Z"), endsAt: new Date("2026-11-16T11:00:00Z") },
    // Bea de vacaciones del domingo al martes: el lunes se recorta al día
    { staffId: bea, startsAt: new Date("2026-11-15T00:00:00Z"), endsAt: new Date("2026-11-18T00:00:00Z") },
  ]);
}, 30_000);

afterAll(async () => {
  await pgClient.end();
});

describe("loadAgendaColumns", () => {
  it("por defecto, solo quien trabaja ese día, con sus turnos en orden y su local", async () => {
    const cols = await loadAgendaColumns({ date: MONDAY, zone: ZONE });
    expect(names(cols)).toEqual(["Ana"]);
    const [col] = cols;
    expect(col.working).toBe(true);
    expect(col.shifts.map((s) => [s.start.toISOString(), s.end.toISOString(), s.locationName])).toEqual([
      ["2026-11-16T09:30:00.000Z", "2026-11-16T14:00:00.000Z", "Local uno"],
      ["2026-11-16T16:00:00.000Z", "2026-11-16T20:00:00.000Z", "Local uno"],
    ]);
    expect(col.timeOff.map((t) => [t.start.toISOString(), t.end.toISOString()])).toEqual([
      ["2026-11-16T10:00:00.000Z", "2026-11-16T11:00:00.000Z"],
    ]);
  });

  it("quien tiene citas ese día sale siempre, aunque no trabaje", async () => {
    const cols = await loadAgendaColumns({ date: MONDAY, zone: ZONE, withAppointments: [carla] });
    expect(names(cols)).toEqual(["Ana", "Carla"]);
    expect(cols[1]).toMatchObject({ working: false, shifts: [] });
  });

  it("con «Todas» y un local: también las de ese local que no trabajan ese día", async () => {
    const cols = await loadAgendaColumns({ date: MONDAY, zone: ZONE, locationId: loc1, all: true });
    expect(names(cols)).toEqual(["Ana", "Bea"]);
    // Las vacaciones de Bea, recortadas al lunes
    expect(cols[1].timeOff.map((t) => [t.start.toISOString(), t.end.toISOString()])).toEqual([
      ["2026-11-16T00:00:00.000Z", "2026-11-17T00:00:00.000Z"],
    ]);
  });

  it("con «Todas» sin local: todas las activas", async () => {
    const cols = await loadAgendaColumns({ date: MONDAY, zone: ZONE, all: true });
    expect(names(cols)).toEqual(["Ana", "Bea", "Carla"]);
  });

  it("con un local donde nadie trabaja ese día, ninguna columna", async () => {
    expect(await loadAgendaColumns({ date: MONDAY, zone: ZONE, locationId: loc2 })).toEqual([]);
  });

  it("una profesional desactivada con citas sale, pero sin turnos", async () => {
    await db.update(staff).set({ active: false }).where(eq(staff.id, ana));
    try {
      expect(names(await loadAgendaColumns({ date: MONDAY, zone: ZONE }))).toEqual([]);
      const cols = await loadAgendaColumns({ date: MONDAY, zone: ZONE, withAppointments: [ana] });
      expect(cols).toHaveLength(1);
      expect(cols[0]).toMatchObject({ staffName: "Ana", working: false, shifts: [] });
    } finally {
      await db.update(staff).set({ active: true }).where(eq(staff.id, ana));
    }
  });
});
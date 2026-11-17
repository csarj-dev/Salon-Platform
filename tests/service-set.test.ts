import "./test-env"; // tiene que ser el primer import
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, pgClient } from "../db";
import {
  appointment, client, location, locationService, schedule,
  service, staff, staffService, timeOff,
} from "../db/schema";
import { getAvailabilityForRange } from "../lib/availability-range";
import { getAvailabilityForService } from "../lib/availability-service";
import { listStaffForService } from "../lib/catalog";
import { loadServiceSet, serviceIdList, staffDoingAll } from "../lib/service-set";

const opts = { zone: "Atlantic/Canary", stepMin: 30, bufferMin: 0, minNoticeHours: 2 };
const NOW = new Date("2026-10-19T10:00:00Z");
const DAY = "2026-11-02"; // lunes; en Canarias, hora de invierno (UTC+0)
const hhmm = (d: Date) => d.toISOString().slice(11, 16);

let loc: number;
let laminado: number; // 60 min
let diseno: number; // 30 min
let lifting: number; // solo en el otro local
let lucia: number; // hace laminado y diseño
let ana: number; // solo laminado

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.delete(appointment);
  await db.delete(timeOff);
  await db.delete(schedule);
  await db.delete(locationService);
  await db.delete(staffService);
  await db.delete(client);
  await db.delete(staff);
  await db.delete(service);
  await db.delete(location);

  const [l, other] = await db
    .insert(location)
    .values([{ name: "Local de prueba" }, { name: "Otro local" }])
    .returning();
  const [a, b, c] = await db
    .insert(service)
    .values([
      { name: "Laminado", durationMin: 60, priceCents: 4500 },
      { name: "Diseño", durationMin: 30, priceCents: 1800 },
      { name: "Lifting", durationMin: 75, priceCents: 5500 },
    ])
    .returning();
  const [s1, s2] = await db.insert(staff).values([{ name: "Lucía" }, { name: "Ana" }]).returning();

  await db.insert(locationService).values([
    { locationId: l.id, serviceId: a.id },
    { locationId: l.id, serviceId: b.id },
    { locationId: other.id, serviceId: c.id },
  ]);
  await db.insert(staffService).values([
    { staffId: s1.id, serviceId: a.id },
    { staffId: s1.id, serviceId: b.id },
    { staffId: s2.id, serviceId: a.id },
  ]);
  // Las dos, los lunes de 10:00 a 14:00 en este local
  await db.insert(schedule).values(
    [s1, s2].map((s) => ({ staffId: s.id, locationId: l.id, weekday: 1, startTime: "10:00", endTime: "14:00" })),
  );

  loc = l.id;
  laminado = a.id;
  diseno = b.id;
  lifting = c.id;
  lucia = s1.id;
  ana = s2.id;
}, 30_000);

afterAll(async () => {
  await pgClient.end();
});

describe("serviceIdList", () => {
  it("acepta uno o varios y quita repetidos sin cambiar el orden", () => {
    expect(serviceIdList(5)).toEqual([5]);
    expect(serviceIdList([7, 5, 7])).toEqual([7, 5]);
  });
});

describe("loadServiceSet", () => {
  it("suma las duraciones de los servicios", async () => {
    expect(await loadServiceSet(loc, [laminado, diseno])).toEqual({ ids: [laminado, diseno], durationMin: 90 });
    expect(await loadServiceSet(loc, laminado)).toEqual({ ids: [laminado], durationMin: 60 });
  });

  it("null si el local no ofrece alguno, si no existe o si no hay ninguno", async () => {
    expect(await loadServiceSet(loc, [laminado, lifting])).toBeNull();
    expect(await loadServiceSet(loc, 999_999)).toBeNull();
    expect(await loadServiceSet(loc, [])).toBeNull();
  });
});

describe("profesionales que los hacen todos", () => {
  it("staffDoingAll", async () => {
    expect(await staffDoingAll([laminado, diseno])).toEqual([lucia]);
    expect((await staffDoingAll([laminado])).sort()).toEqual([lucia, ana].sort());
  });

  it("listStaffForService con uno o con varios", async () => {
    expect((await listStaffForService(loc, laminado)).map((m) => m.name)).toEqual(["Ana", "Lucía"]);
    expect((await listStaffForService(loc, [laminado, diseno])).map((m) => m.id)).toEqual([lucia]);
  });
});

describe("horas con varios servicios seguidos", () => {
  it("solo la que los hace todos, y solo donde cabe la suma (1 h 30)", async () => {
    const r = await getAvailabilityForService(loc, [laminado, diseno], DAY, opts, NOW);
    expect(r.perStaff.map((p) => p.staffId)).toEqual([lucia]);
    const slots = r.perStaff[0].slots.map(hhmm);
    expect(slots[0]).toBe("10:00");
    expect(slots.at(-1)).toBe("12:30"); // 12:30 + 1 h 30 = 14:00, fin del turno
  });

  it("el rango da lo mismo que día a día", async () => {
    const range = await getAvailabilityForRange(loc, [laminado, diseno], DAY, DAY, opts, NOW);
    const single = await getAvailabilityForService(loc, [laminado, diseno], DAY, opts, NOW);
    expect(range.get(DAY)).toEqual(single);
  });
});
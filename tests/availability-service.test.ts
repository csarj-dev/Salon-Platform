import "./test-env"; // tiene que ser el primer import
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, pgClient } from "../db";
import {
  appointment, client, location, locationService, schedule,
  service, staff, staffService, timeOff,
} from "../db/schema";
import { getAvailabilityForService } from "../lib/availability-service";

const opts = { zone: "Atlantic/Canary", stepMin: 30, bufferMin: 0, minNoticeHours: 2 };
const NOW = new Date("2026-10-19T10:00:00Z");
// Lunes 2 de noviembre de 2026: en Canarias es hora de invierno (UTC+0)
const at = (hhmm: string) => new Date(`2026-11-02T${hhmm}:00Z`);
const hhmm = (d: Date) => d.toISOString().slice(11, 16);

let locationId: number;
let serviceId: number;
let anaId: number;
let luciaId: number;

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

  const [loc] = await db.insert(location).values({ name: "Local de prueba" }).returning();
  const [svc] = await db
    .insert(service)
    .values({ name: "Servicio de prueba", durationMin: 60, priceCents: 4500 })
    .returning();
  const [ana, lucia] = await db
    .insert(staff)
    .values([{ name: "Ana" }, { name: "Lucía" }])
    .returning();

  locationId = loc.id;
  serviceId = svc.id;
  anaId = ana.id;
  luciaId = lucia.id;

  await db.insert(locationService).values({ locationId, serviceId });
  await db.insert(staffService).values([
    { staffId: anaId, serviceId },
    { staffId: luciaId, serviceId },
  ]);
  // Las dos trabajan los lunes de 10:00 a 14:00 en este local
  await db.insert(schedule).values([
    { staffId: anaId, locationId, weekday: 1, startTime: "10:00", endTime: "14:00" },
    { staffId: luciaId, locationId, weekday: 1, startTime: "10:00", endTime: "14:00" },
  ]);

  // Ana tiene una cita de 10:00 a 11:00
  const [c] = await db
    .insert(client)
    .values({ name: "Clienta Test", phone: "600111222" })
    .returning();
  await db.insert(appointment).values({
    clientId: c.id,
    clientName: "Clienta Test",
    serviceId,
    staffId: anaId,
    locationId,
    startsAt: at("10:00"),
    endsAt: at("11:00"),
    priceAppliedCents: 4500,
    source: "web",
  });
}, 30_000);

afterAll(async () => {
  await pgClient.end();
});

describe("getAvailabilityForService", () => {
  it("devuelve los huecos de cada profesional por separado", async () => {
    const r = await getAvailabilityForService(locationId, serviceId, "2026-11-02", opts, NOW);

    expect(r.perStaff.map((p) => p.staffName)).toEqual(["Ana", "Lucía"]);

    const ana = r.perStaff.find((p) => p.staffId === anaId)!;
    const lucia = r.perStaff.find((p) => p.staffId === luciaId)!;
    expect(ana.slots.map(hhmm)).toEqual(["11:00", "11:30", "12:00", "12:30", "13:00"]);
    expect(lucia.slots.map(hhmm)).toEqual(["10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00"]);
  });

  it("une los huecos para quien elige cualquiera", async () => {
    const r = await getAvailabilityForService(locationId, serviceId, "2026-11-02", opts, NOW);

    const first = r.any[0];
    expect(hhmm(first.startsAt)).toBe("10:00");
    expect(first.staffIds).toEqual([luciaId]); // a las 10:00 solo está libre Lucía

    const at11 = r.any.find((s) => hhmm(s.startsAt) === "11:00")!;
    expect([...at11.staffIds].sort()).toEqual([anaId, luciaId].sort());
  });

  it("no incluye a las profesionales inactivas", async () => {
    await db.update(staff).set({ active: false }).where(eq(staff.id, luciaId));

    const r = await getAvailabilityForService(locationId, serviceId, "2026-11-02", opts, NOW);
    expect(r.perStaff.map((p) => p.staffName)).toEqual(["Ana"]);
  });
});
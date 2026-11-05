import "./test-env"; // tiene que ser el primer import
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, pgClient } from "../db";
import {
  appointment, client, location, locationService, schedule, service, staff, staffService, timeOff,
} from "../db/schema";
import { collectorForAppointment, collectorForStaff, listStaffCollectors } from "../lib/collectors-db";
import { salonConfigSchema } from "../lib/salon-config";

const config = salonConfigSchema.parse({
  name: "Salón de prueba",
  timezone: "Atlantic/Canary",
  locales: ["es"],
  defaultLocale: "es",
  contact: { whatsapp: "34600000000" },
  booking: {},
  payments: {
    defaultCollector: "salon",
    collectors: { salon: { label: "Salón" }, amanda: { label: "Amanda" }, luz: { label: "Luz" } },
  },
  koibox: { accounts: { amanda: { label: "Amanda", keyEnv: "KOIBOX_KEY_AMANDA", collector: "amanda" } } },
});

let ids: { ana: number; amanda: number; luz: number; antigua: number; appt: number };

// Mismo orden que los demás tests: lo que apunta a staff, service o location va antes
async function wipe() {
  await db.delete(appointment);
  await db.delete(timeOff);
  await db.delete(schedule);
  await db.delete(locationService);
  await db.delete(staffService);
  await db.delete(client);
  await db.delete(staff);
  await db.delete(service);
  await db.delete(location);
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await wipe();
  const [ana, amanda, luz, antigua] = await db
    .insert(staff)
    .values([
      { name: "Ana" }, // sin cuenta ni cobrador: el de por defecto
      { name: "Amanda", koiboxAccount: "amanda", koiboxUserId: 1 }, // el de su cuenta
      { name: "Luz", koiboxAccount: "amanda", koiboxUserId: 2, collector: "luz" }, // el suyo manda
      { name: "Antigua", collector: "ya-no-existe" },
    ])
    .returning();
  const [loc] = await db.insert(location).values({ name: "Local" }).returning();
  const [svc] = await db.insert(service).values({ name: "Lifting", durationMin: 60, priceCents: 5000 }).returning();
  const [cli] = await db.insert(client).values({ name: "Laura", phone: "600111222" }).returning();
  const [appt] = await db
    .insert(appointment)
    .values({
      clientId: cli.id,
      clientName: "Laura",
      serviceId: svc.id,
      staffId: luz.id,
      locationId: loc.id,
      startsAt: new Date("2026-11-10T10:00:00Z"),
      endsAt: new Date("2026-11-10T11:00:00Z"),
      priceAppliedCents: 5000,
      source: "web",
    })
    .returning();
  ids = { ana: ana.id, amanda: amanda.id, luz: luz.id, antigua: antigua.id, appt: appt.id };
}, 30_000);

afterAll(async () => {
  await wipe();
  await pgClient.end();
});

describe("cobrador desde la base", () => {
  it("de la profesional, de su cuenta o el de por defecto", async () => {
    expect((await collectorForStaff(ids.ana, config)).id).toBe("salon");
    expect((await collectorForStaff(ids.amanda, config)).id).toBe("amanda");
    expect((await collectorForStaff(ids.luz, config)).id).toBe("luz");
    expect((await collectorForStaff(ids.antigua, config)).id).toBe("salon");
  });

  it("el de una cita es el de su profesional", async () => {
    expect((await collectorForAppointment(ids.appt, config)).id).toBe("luz");
  });

  it("la lista explica de dónde sale y avisa de los que ya no existen", async () => {
    const list = await listStaffCollectors(config);
    expect(list.map((r) => [r.staffName, r.choice.collector.id, r.choice.source, r.choice.ignored])).toEqual([
      ["Amanda", "amanda", "account", null],
      ["Ana", "salon", "default", null],
      ["Antigua", "salon", "default", "ya-no-existe"],
      ["Luz", "luz", "staff", null],
    ]);
  });

  it("la base no admite ids de cobrador con mayúsculas o espacios", async () => {
    await expect(db.update(staff).set({ collector: "Amanda R" }).where(eq(staff.id, ids.ana))).rejects.toThrow();
  });
});
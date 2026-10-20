import "./test-env"; // tiene que ser el primer import
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, pgClient } from "../db";
import {
  appointment, client, location, locationService, schedule,
  service, staff, staffService, timeOff,
} from "../db/schema";
import { createAppointment, type BookingOptions } from "../lib/booking";

const opts: BookingOptions = {
  zone: "Atlantic/Canary",
  stepMin: 30,
  bufferMin: 0,
  minNoticeHours: 2,
  maxDaysAhead: 60,
};

const NOW = new Date("2026-10-19T10:00:00Z");
// Lunes 2 de noviembre de 2026: en Canarias es hora de invierno (UTC+0)
const at = (hhmm: string) => new Date(`2026-11-02T${hhmm}:00Z`);

let ids: { locationId: number; serviceId: number; staffId: number };

const input = (
  startsAt: Date,
  phone = "600111222",
  extra: Record<string, unknown> = {},
) => ({
  ...ids,
  startsAt,
  source: "web",
  consent: true,
  client: { name: "Clienta Test", phone },
  ...extra,
});

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

  const [loc] = await db.insert(location).values({ name: "Local de prueba" }).returning();
  const [svc] = await db
    .insert(service)
    .values({ name: "Servicio de prueba", durationMin: 60, priceCents: 4500 })
    .returning();
  const [st] = await db.insert(staff).values({ name: "Profesional de prueba" }).returning();

  await db.insert(locationService).values({ locationId: loc.id, serviceId: svc.id });
  await db.insert(staffService).values({ staffId: st.id, serviceId: svc.id });
  // Lunes de 10:00 a 14:00
  await db.insert(schedule).values({
    staffId: st.id,
    locationId: loc.id,
    weekday: 1,
    startTime: "10:00",
    endTime: "14:00",
  });

  ids = { locationId: loc.id, serviceId: svc.id, staffId: st.id };
}, 30_000);

beforeEach(async () => {
  await db.delete(appointment);
  await db.delete(client);
});

afterAll(async () => {
  await pgClient.end();
});

describe("createAppointment", () => {
  it("reserva un hueco libre y guarda precio y fin", async () => {
    const r = await createAppointment(input(at("10:00")), opts, NOW);
    expect(r.ok).toBe(true);

    const rows = await db.select().from(appointment);
    expect(rows).toHaveLength(1);
    expect(rows[0].endsAt.toISOString()).toBe("2026-11-02T11:00:00.000Z");
    expect(rows[0].priceAppliedCents).toBe(4500);
    expect(rows[0].status).toBe("booked");
  });

  it("rechaza un hueco que se solapa con una cita existente", async () => {
    await createAppointment(input(at("10:00")), opts, NOW);
    const r = await createAppointment(input(at("10:30"), "600333444"), opts, NOW);
    expect(r).toEqual({ ok: false, reason: "slot_unavailable" });
  });

  it("con varias reservas simultáneas al mismo hueco, solo entra una", async () => {
    const phones = ["600000001", "600000002", "600000003", "600000004", "600000005"];
    const results = await Promise.all(
      phones.map((p) => createAppointment(input(at("11:00"), p), opts, NOW)),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(1);

    const reasons = results.flatMap((r) => (r.ok ? [] : [r.reason]));
    expect(reasons).toHaveLength(4);
    for (const reason of reasons) {
      expect(["slot_taken", "slot_unavailable"]).toContain(reason);
    }

    expect(await db.select().from(appointment)).toHaveLength(1);
  });

  it("rechaza una hora fuera del turno", async () => {
    const r = await createAppointment(input(at("15:00")), opts, NOW);
    expect(r).toEqual({ ok: false, reason: "slot_unavailable" });
  });

  it("rechaza un hueco que no respeta la antelación mínima", async () => {
    // A las 09:00 con 2 h de antelación, lo más pronto son las 11:00
    const r = await createAppointment(input(at("10:00")), opts, at("09:00"));
    expect(r).toEqual({ ok: false, reason: "slot_unavailable" });
  });

  it("rechaza una fecha más allá del máximo de días", async () => {
    const r = await createAppointment(input(at("10:00")), opts, new Date("2026-08-01T10:00:00Z"));
    expect(r).toEqual({ ok: false, reason: "slot_unavailable" });
  });

  it("rechaza un teléfono inválido", async () => {
    const r = await createAppointment(input(at("10:00"), "123"), opts, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_input");
  });

  it("exige el consentimiento en reservas web", async () => {
    const r = await createAppointment(
      input(at("10:00"), "600111222", { consent: false }),
      opts,
      NOW,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_input");
  });

  it("una cita cancelada libera el hueco", async () => {
    const first = await createAppointment(input(at("10:00")), opts, NOW);
    if (!first.ok) throw new Error("La primera reserva debía funcionar");

    await db
      .update(appointment)
      .set({ status: "cancelled", cancelledAt: NOW })
      .where(eq(appointment.id, first.appointmentId));

    const second = await createAppointment(input(at("10:00"), "600555666"), opts, NOW);
    expect(second.ok).toBe(true);
  });

  it("reutiliza la clienta si el teléfono ya existe", async () => {
    await createAppointment(input(at("10:00")), opts, NOW);
    await createAppointment(input(at("12:00")), opts, NOW);
    expect(await db.select().from(client)).toHaveLength(1);
    expect(await db.select().from(appointment)).toHaveLength(2);
  });
});
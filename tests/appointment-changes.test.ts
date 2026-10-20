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
import {
  cancelAppointment, rescheduleAppointment, type ChangeOptions,
} from "../lib/appointment-changes";

const bookingOpts: BookingOptions = {
  zone: "Atlantic/Canary",
  stepMin: 30,
  bufferMin: 0,
  minNoticeHours: 2,
  maxDaysAhead: 60,
};
const changeOpts: ChangeOptions = { cancellationNoticeHours: 24 };

const NOW = new Date("2026-10-19T10:00:00Z");
// Lunes 2 de noviembre de 2026: en Canarias es hora de invierno (UTC+0)
const at = (hhmm: string) => new Date(`2026-11-02T${hhmm}:00Z`);

let ids: { locationId: number; serviceId: number; staffId: number };

const input = (startsAt: Date, phone = "600111222") => ({
  ...ids,
  startsAt,
  source: "web",
  consent: true,
  client: { name: "Clienta Test", phone },
});

async function book(startsAt: Date, phone = "600111222"): Promise<number> {
  const r = await createAppointment(input(startsAt, phone), bookingOpts, NOW);
  if (!r.ok) throw new Error("La reserva de preparación debía funcionar");
  return r.appointmentId;
}

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

describe("cancelAppointment", () => {
  it("cancela una cita con tiempo y libera el hueco", async () => {
    const id = await book(at("10:00"));
    const r = await cancelAppointment(id, changeOpts, "client", NOW);
    expect(r).toEqual({ ok: true });

    const [row] = await db.select().from(appointment).where(eq(appointment.id, id));
    expect(row.status).toBe("cancelled");
    expect(row.cancelledAt).not.toBeNull();

    // El hueco vuelve a estar libre
    const again = await createAppointment(input(at("10:00"), "600555666"), bookingOpts, NOW);
    expect(again.ok).toBe(true);
  });

  it("una clienta no puede cancelar dentro del plazo", async () => {
    const id = await book(at("10:00"));
    // A las 09:00 faltan solo 1 h y el plazo es de 24 h
    const r = await cancelAppointment(id, changeOpts, "client", at("09:00"));
    expect(r).toEqual({ ok: false, reason: "too_late" });
  });

  it("recepción sí puede cancelar dentro del plazo", async () => {
    const id = await book(at("10:00"));
    const r = await cancelAppointment(id, changeOpts, "staff", at("09:00"));
    expect(r).toEqual({ ok: true });
  });

  it("no cancela una cita que no existe", async () => {
    const r = await cancelAppointment(999999, changeOpts, "client", NOW);
    expect(r).toEqual({ ok: false, reason: "not_found" });
  });

  it("no cancela dos veces la misma cita", async () => {
    const id = await book(at("10:00"));
    await cancelAppointment(id, changeOpts, "client", NOW);
    const r = await cancelAppointment(id, changeOpts, "client", NOW);
    expect(r).toEqual({ ok: false, reason: "not_changeable" });
  });
});

describe("rescheduleAppointment", () => {
  it("mueve la cita a un hueco libre", async () => {
    const id = await book(at("10:00"));
    const r = await rescheduleAppointment(id, at("12:00"), bookingOpts, changeOpts, "client", NOW);
    expect(r).toEqual({ ok: true });

    const [row] = await db.select().from(appointment).where(eq(appointment.id, id));
    expect(row.startsAt.toISOString()).toBe("2026-11-02T12:00:00.000Z");
    expect(row.endsAt.toISOString()).toBe("2026-11-02T13:00:00.000Z");
    expect(row.priceAppliedCents).toBe(4500);
  });

  it("permite moverla a una hora que se solapa con su propio hueco actual", async () => {
    const id = await book(at("10:00"));
    const r = await rescheduleAppointment(id, at("10:30"), bookingOpts, changeOpts, "client", NOW);
    expect(r).toEqual({ ok: true });

    const [row] = await db.select().from(appointment).where(eq(appointment.id, id));
    expect(row.startsAt.toISOString()).toBe("2026-11-02T10:30:00.000Z");
    expect(row.endsAt.toISOString()).toBe("2026-11-02T11:30:00.000Z");
  });

  it("rechaza moverla a un hueco ocupado por otra cita", async () => {
    const id = await book(at("10:00"));
    await book(at("12:00"), "600333444");
    const r = await rescheduleAppointment(id, at("12:30"), bookingOpts, changeOpts, "client", NOW);
    expect(r).toEqual({ ok: false, reason: "slot_unavailable" });
  });

  it("una clienta no puede moverla dentro del plazo", async () => {
    const id = await book(at("10:00"));
    const r = await rescheduleAppointment(id, at("12:00"), bookingOpts, changeOpts, "client", at("09:00"));
    expect(r).toEqual({ ok: false, reason: "too_late" });
  });

  it("no mueve una cita cancelada", async () => {
    const id = await book(at("10:00"));
    await cancelAppointment(id, changeOpts, "client", NOW);
    const r = await rescheduleAppointment(id, at("12:00"), bookingOpts, changeOpts, "client", NOW);
    expect(r).toEqual({ ok: false, reason: "not_changeable" });
  });

  it("rechaza una hora fuera del turno", async () => {
    const id = await book(at("10:00"));
    const r = await rescheduleAppointment(id, at("15:00"), bookingOpts, changeOpts, "client", NOW);
    expect(r).toEqual({ ok: false, reason: "slot_unavailable" });
  });
});
import "./test-env"; // tiene que ser el primer import
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, pgClient } from "../db";
import {
  appointment, client, location, locationService, schedule,
  service, staff, staffService, timeOff,
} from "../db/schema";
import { getAvailabilityForDay } from "../lib/availability-db";
import { cancelAppointment } from "../lib/appointment-changes";
import { getConfirmation } from "../lib/appointment-view";
import { createAppointment, type BookingOptions } from "../lib/booking";
import { expireOverdueDeposits, listDeposits, markDepositPaid } from "../lib/deposit-db";

const opts: BookingOptions = {
  zone: "Atlantic/Canary",
  stepMin: 30,
  bufferMin: 0,
  minNoticeHours: 2,
  maxDaysAhead: 60,
  depositHoldHours: 24,
};

const NOW = new Date("2026-10-19T10:00:00Z");
const LATER = new Date("2026-10-20T11:00:00Z"); // 25 h después: el plazo de 24 h ya venció
// Lunes 2 de noviembre de 2026: en Canarias es hora de invierno (UTC+0)
const at = (hhmm: string) => new Date(`2026-11-02T${hhmm}:00Z`);
const DAY = "2026-11-02";

let loc: number;
let st: number;
let withDeposit: number; // 15 € de depósito
let plain: number; // sin depósito
let consult: number; // con consulta previa

const input = (
  serviceId: number,
  startsAt: Date,
  extra: Record<string, unknown> = {},
  phone = "600111222",
) => ({
  locationId: loc,
  staffId: st,
  serviceId,
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

// Reserva un servicio con depósito y devuelve el resultado ya comprobado
async function bookDeposit(startsAt = at("10:00"), now = NOW, phone = "600111222") {
  const r = await createAppointment(input(withDeposit, startsAt, {}, phone), opts, now);
  if (!r.ok) throw new Error(`No se pudo reservar: ${r.reason}`);
  return r;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await wipe();

  const [l] = await db.insert(location).values({ name: "Local de prueba" }).returning();
  const [a, b, c] = await db
    .insert(service)
    .values([
      { name: "Con depósito", durationMin: 60, priceCents: 4500, depositCents: 1500 },
      { name: "Sin depósito", durationMin: 60, priceCents: 3000 },
      { name: "Con consulta", durationMin: 60, priceCents: 9000, requiresConsultation: true },
    ])
    .returning();
  const [s] = await db.insert(staff).values({ name: "Profesional de prueba" }).returning();

  loc = l.id;
  st = s.id;
  withDeposit = a.id;
  plain = b.id;
  consult = c.id;

  await db.insert(locationService).values(
    [a, b, c].map((x) => ({ locationId: l.id, serviceId: x.id })),
  );
  await db.insert(staffService).values([a, b, c].map((x) => ({ staffId: s.id, serviceId: x.id })));
  // Lunes de 10:00 a 14:00
  await db.insert(schedule).values({
    staffId: s.id,
    locationId: l.id,
    weekday: 1,
    startTime: "10:00",
    endTime: "14:00",
  });
}, 30_000);

beforeEach(async () => {
  await db.delete(appointment);
  await db.delete(client);
  await db.update(location).set({ active: true }).where(eq(location.id, loc));
});

afterAll(async () => {
  await pgClient.end();
});

describe("reservar con y sin depósito", () => {
  it("un servicio con depósito queda pendiente, con importe y plazo", async () => {
    const r = await bookDeposit();
    expect(r.status).toBe("pending_deposit");
    expect(r.deposit).toEqual({ cents: 1500, dueAt: new Date("2026-10-20T10:00:00Z") });

    const [row] = await db.select().from(appointment).where(eq(appointment.id, r.appointmentId));
    expect(row.status).toBe("pending_deposit");
    expect(row.depositCents).toBe(1500);
    expect(row.depositDueAt).toEqual(new Date("2026-10-20T10:00:00Z"));
    expect(row.depositPaidAt).toBeNull();
    expect(row.publicToken).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.publicToken).toBe(row.publicToken);
  });

  it("el plazo nunca pasa del inicio de la cita", async () => {
    // Cita en 3 horas, con un plazo de 24 h: el depósito vence al empezar la cita
    const r = await bookDeposit(at("10:00"), at("07:00"));
    expect(r.deposit?.dueAt).toEqual(at("10:00"));
  });

  it("un servicio sin depósito se confirma al momento", async () => {
    const r = await createAppointment(input(plain, at("10:00")), opts, NOW);
    expect(r).toMatchObject({ ok: true, status: "booked", deposit: null });
    const [row] = await db.select().from(appointment);
    expect(row.status).toBe("booked");
    expect(row.depositCents).toBeNull();
  });

  it("recepción (teléfono o WhatsApp) no pide depósito", async () => {
    const r = await createAppointment(input(withDeposit, at("10:00"), { source: "phone" }), opts, NOW);
    expect(r).toMatchObject({ ok: true, status: "booked", deposit: null });
  });

  it("cambiar el importe del servicio no cambia las citas ya hechas", async () => {
    const r = await bookDeposit();
    await db.update(service).set({ depositCents: 2000 }).where(eq(service.id, withDeposit));
    try {
      const [row] = await db.select().from(appointment).where(eq(appointment.id, r.appointmentId));
      expect(row.depositCents).toBe(1500);
    } finally {
      await db.update(service).set({ depositCents: 1500 }).where(eq(service.id, withDeposit));
    }
  });

  it("lo que pide consulta previa no se reserva por la web", async () => {
    const r = await createAppointment(input(consult, at("10:00")), opts, NOW);
    expect(r).toEqual({ ok: false, reason: "slot_unavailable" });
  });

  it("un local desactivado no admite reservas por la web", async () => {
    await db.update(location).set({ active: false }).where(eq(location.id, loc));
    const r = await createAppointment(input(plain, at("10:00")), opts, NOW);
    expect(r).toEqual({ ok: false, reason: "slot_unavailable" });
  });
});

describe("el hueco mientras espera el depósito", () => {
  it("una cita pendiente ocupa el hueco dentro del plazo", async () => {
    await bookDeposit(at("10:00"));
    const slots = await getAvailabilityForDay(loc, st, plain, DAY, opts, NOW);
    expect(slots.map((s) => s.getTime())).not.toContain(at("10:00").getTime());

    const r = await createAppointment(input(plain, at("10:30"), {}, "600333444"), opts, NOW);
    expect(r).toEqual({ ok: false, reason: "slot_unavailable" });
  });

  it("vencido el plazo, el hueco vuelve a estar disponible aunque nadie lo haya liberado", async () => {
    await bookDeposit(at("10:00"));
    const slots = await getAvailabilityForDay(loc, st, plain, DAY, opts, LATER);
    expect(slots.map((s) => s.getTime())).toContain(at("10:00").getTime());
  });

  it("otra clienta puede reservar el hueco vencido y la primera cita queda caducada", async () => {
    const first = await bookDeposit(at("10:00"));
    const second = await createAppointment(input(plain, at("10:00"), {}, "600333444"), opts, LATER);
    expect(second).toMatchObject({ ok: true, status: "booked" });

    const [row] = await db.select().from(appointment).where(eq(appointment.id, first.appointmentId));
    expect(row.status).toBe("expired");
  });

  it("una cita caducada no bloquea el hueco en la base de datos", async () => {
    const first = await bookDeposit(at("10:00"));
    await db.update(appointment).set({ status: "expired" }).where(eq(appointment.id, first.appointmentId));
    await expect(
      createAppointment(input(plain, at("10:00"), {}, "600333444"), opts, NOW),
    ).resolves.toMatchObject({ ok: true });
  });

  it("la base de datos exige importe y plazo a una cita pendiente", async () => {
    const [c] = await db.insert(client).values({ name: "X", phone: "600999888" }).returning();
    await expect(
      db.insert(appointment).values({
        clientId: c.id,
        serviceId: withDeposit,
        staffId: st,
        locationId: loc,
        startsAt: at("12:00"),
        endsAt: at("13:00"),
        status: "pending_deposit",
        priceAppliedCents: 4500,
        source: "web",
      }),
    ).rejects.toThrow();
  });
});

describe("gestionar el depósito", () => {
  it("al marcarlo como pagado la cita queda confirmada", async () => {
    const r = await bookDeposit();
    const paidAt = new Date("2026-10-19T12:00:00Z");
    expect(await markDepositPaid(r.appointmentId, paidAt)).toEqual({ ok: true });

    const [row] = await db.select().from(appointment).where(eq(appointment.id, r.appointmentId));
    expect(row.status).toBe("booked");
    expect(row.depositPaidAt).toEqual(paidAt);
  });

  it("no se puede marcar dos veces, ni una cita que no existe o no espera depósito", async () => {
    const r = await bookDeposit();
    await markDepositPaid(r.appointmentId, NOW);
    expect(await markDepositPaid(r.appointmentId, NOW)).toEqual({ ok: false, reason: "not_pending" });
    expect(await markDepositPaid(999_999, NOW)).toEqual({ ok: false, reason: "not_found" });

    const plainBooking = await createAppointment(input(plain, at("12:00")), opts, NOW);
    if (!plainBooking.ok) throw new Error("no se pudo reservar");
    expect(await markDepositPaid(plainBooking.appointmentId, NOW)).toEqual({
      ok: false,
      reason: "not_pending",
    });
  });

  it("con el plazo vencido pero el hueco sin liberar, el pago todavía se acepta", async () => {
    const r = await bookDeposit();
    expect(await markDepositPaid(r.appointmentId, LATER)).toEqual({ ok: true });
  });

  it("si ya caducó, el pago no se acepta solo: lo decide el salón", async () => {
    const r = await bookDeposit();
    expect(await expireOverdueDeposits(LATER)).toBe(1);
    expect(await markDepositPaid(r.appointmentId, LATER)).toEqual({ ok: false, reason: "expired" });
  });

  it("expirar solo toca las pendientes cuyo plazo venció", async () => {
    await bookDeposit(at("10:00")); // vence el día 20 a las 10:00
    // Reservada más tarde, vence el día 20 a las 13:00: todavía no ha vencido en LATER (11:00)
    await bookDeposit(at("12:00"), new Date("2026-10-19T13:00:00Z"), "600222333");
    await createAppointment(input(plain, at("13:00")), opts, NOW); // confirmada

    expect(await expireOverdueDeposits(LATER)).toBe(1);
    const rows = await db.select({ status: appointment.status }).from(appointment);
    expect(rows.map((r) => r.status).sort()).toEqual(["booked", "expired", "pending_deposit"]);
  });

  it("la lista de depósitos trae los datos de contacto para escribir a la clienta", async () => {
    await bookDeposit();
    const rows = await listDeposits("pending_deposit");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      clientName: "Clienta Test",
      clientPhone: "600111222",
      depositCents: 1500,
      serviceName: "Con depósito",
    });
    expect(await listDeposits("expired")).toEqual([]);

    await expireOverdueDeposits(LATER);
    expect(await listDeposits("pending_deposit")).toEqual([]);
    expect(await listDeposits("expired")).toHaveLength(1);
  });
});

describe("cancelar", () => {
  const changeOpts = { cancellationNoticeHours: 24 };

  it("una cita que espera el depósito se cancela aunque falte poco: no ha pagado nada", async () => {
    const r = await bookDeposit();
    const oneHourBefore = at("09:00");
    expect(await cancelAppointment(r.appointmentId, changeOpts, "client", oneHourBefore)).toEqual({
      ok: true,
    });
    const [row] = await db.select().from(appointment).where(eq(appointment.id, r.appointmentId));
    expect(row.status).toBe("cancelled");
  });

  it("una cita confirmada sigue sujeta al plazo de cancelación", async () => {
    const r = await createAppointment(input(plain, at("10:00")), opts, NOW);
    if (!r.ok) throw new Error("no se pudo reservar");
    expect(await cancelAppointment(r.appointmentId, changeOpts, "client", at("09:00"))).toEqual({
      ok: false,
      reason: "too_late",
    });
  });

  it("una cita caducada ya no se puede cancelar", async () => {
    const r = await bookDeposit();
    await expireOverdueDeposits(LATER);
    expect(await cancelAppointment(r.appointmentId, changeOpts, "staff", LATER)).toEqual({
      ok: false,
      reason: "not_changeable",
    });
  });
});

describe("página de confirmación", () => {
  it("se consulta con el token y no devuelve datos de contacto", async () => {
    const r = await bookDeposit();
    const view = await getConfirmation(r.publicToken, "es", "es", NOW);
    expect(view).toMatchObject({
      id: r.appointmentId,
      status: "pending_deposit",
      serviceName: "Con depósito",
      locationName: "Local de prueba",
      staffName: "Profesional de prueba",
      priceCents: 4500,
      depositCents: 1500,
    });
    expect(JSON.stringify(view)).not.toContain("600111222");
  });

  it("un token que no existe o no es un UUID da null", async () => {
    expect(await getConfirmation("00000000-0000-4000-8000-000000000000", "es", "es", NOW)).toBeNull();
    expect(await getConfirmation("1", "es", "es", NOW)).toBeNull();
    expect(await getConfirmation("' OR 1=1 --", "es", "es", NOW)).toBeNull();
  });

  it("un depósito vencido se muestra como caducado aunque nadie haya liberado el hueco", async () => {
    const r = await bookDeposit();
    expect((await getConfirmation(r.publicToken, "es", "es", LATER))?.status).toBe("expired");
  });
});

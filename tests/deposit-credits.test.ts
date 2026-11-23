import "./test-env"; // tiene que ser el primer import
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, pgClient } from "../db";
import {
  appointment, appointmentService, client, depositCredit, location, locationService, payment, schedule, service,
  serviceCategory, staff, staffService, timeOff,
} from "../db/schema";
import { cancelAppointment, toChangeOptions } from "../lib/appointment-changes";
import { depositsSavedFrom, savedDepositExpiry } from "../lib/deposit-credits";
import { salonConfigSchema } from "../lib/salon-config";

const base = {
  name: "Salón de prueba",
  timezone: "Atlantic/Canary",
  locales: ["es"],
  defaultLocale: "es",
  contact: { whatsapp: "34600000000" },
  payments: {
    defaultCollector: "salon",
    collectors: { salon: { label: "Salón" }, luz: { label: "Luz" } },
  },
};
const config = salonConfigSchema.parse({
  ...base,
  booking: { cancellationNoticeHours: 24, deposit: { saved: { months: 6 } } },
});
const noSaving = salonConfigSchema.parse({ ...base, booking: { cancellationNoticeHours: 24 } });

const NOW = new Date("2026-11-19T10:00:00Z");
let ids: { loc: number; ana: number; luz: number; client: number; cejas: number; pestanas: number; lam: number; dis: number; lift: number; suelto: number };

async function wipe() {
  await db.delete(appointment); // se lleva pagos y depósitos guardados
  await db.delete(timeOff);
  await db.delete(schedule);
  await db.delete(locationService);
  await db.delete(staffService);
  await db.delete(client);
  await db.delete(staff);
  await db.delete(service);
  await db.delete(location);
}

// Una cita confirmada con el depósito pagado (o no), con sus servicios en appointment_service
let slot = 0;
async function bookedAppointment(
  serviceIds: number[],
  depositCents: number,
  opts: { staffId?: number; paid?: boolean; status?: "booked" | "pending_deposit" } = {},
) {
  const startsAt = new Date(Date.UTC(2026, 11, 1, 8) + slot++ * 3 * 3_600_000);
  const status = opts.status ?? "booked";
  const [row] = await db
    .insert(appointment)
    .values({
      clientId: ids.client,
      clientName: "Clienta Test",
      serviceId: serviceIds[0],
      staffId: opts.staffId ?? ids.ana,
      locationId: ids.loc,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 2 * 3_600_000),
      status,
      priceAppliedCents: 9000,
      source: "web",
      depositCents,
      depositDueAt: status === "pending_deposit" ? new Date(NOW.getTime() + 3_600_000) : null,
      depositPaidAt: opts.paid === false || status === "pending_deposit" ? null : NOW,
    })
    .returning({ id: appointment.id });
  await db.insert(appointmentService).values(
    serviceIds.map((serviceId, position) => ({ appointmentId: row.id, position, serviceId, durationMin: 60, priceCents: 3000 })),
  );
  return row.id;
}

const credits = (appointmentId: number) =>
  db.select().from(depositCredit).where(eq(depositCredit.sourceAppointmentId, appointmentId));

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await wipe();
  const [l] = await db.insert(location).values({ name: "Local de prueba" }).returning();
  const [cejas, pestanas] = await db
    .insert(serviceCategory)
    .values([{ name: "Cejas (test credits)" }, { name: "Pestañas (test credits)" }])
    .returning();
  const [lam, dis, lift, suelto] = await db
    .insert(service)
    .values([
      { name: "Laminado", durationMin: 60, priceCents: 4500, depositCents: 1500, categoryId: cejas.id },
      { name: "Diseño", durationMin: 30, priceCents: 1800, depositCents: 1500, categoryId: cejas.id },
      { name: "Lifting", durationMin: 75, priceCents: 5500, depositCents: 2000, categoryId: pestanas.id },
      { name: "Suelto", durationMin: 30, priceCents: 2000, depositCents: 500 },
    ])
    .returning();
  const [ana, luz] = await db.insert(staff).values([{ name: "Ana" }, { name: "Luz", collector: "luz" }]).returning();
  const [c] = await db.insert(client).values({ name: "Clienta Test", phone: "600333444" }).returning();
  ids = {
    loc: l.id, ana: ana.id, luz: luz.id, client: c.id,
    cejas: cejas.id, pestanas: pestanas.id, lam: lam.id, dis: dis.id, lift: lift.id, suelto: suelto.id,
  };
});

beforeEach(async () => {
  await db.delete(appointment);
});

afterAll(async () => {
  await wipe();
  await db.delete(serviceCategory).where(eq(serviceCategory.id, ids.cejas));
  await db.delete(serviceCategory).where(eq(serviceCategory.id, ids.pestanas));
  await pgClient.end();
});

describe("depósito guardado al anular", () => {
  it("la clienta anula a tiempo con el depósito pagado: se le guarda 6 meses", async () => {
    const appt = await bookedAppointment([ids.lam, ids.dis], 1500);
    expect(await cancelAppointment(appt, toChangeOptions(config), "client", NOW)).toEqual({
      ok: true,
      savedDepositCents: 1500,
    });
    const rows = await credits(appt);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      clientId: ids.client,
      amountCents: 1500,
      categoryId: ids.cejas,
      serviceId: null,
      collector: "salon",
      createdAt: NOW,
      expiresAt: savedDepositExpiry(NOW, 6, "Atlantic/Canary"),
      usedAt: null,
    });
    // Las 10:00 de Canarias: en noviembre es UTC+0 y en mayo UTC+1, así que son las 09:00 UTC
    expect(rows[0].expiresAt.toISOString()).toBe("2027-05-19T09:00:00.000Z");
    expect(await depositsSavedFrom(appt)).toHaveLength(1);
  });

  it("cejas + pestañas: uno por categoría; un servicio sin categoría, el suyo", async () => {
    const appt = await bookedAppointment([ids.lam, ids.lift, ids.suelto], 4000);
    expect(await cancelAppointment(appt, toChangeOptions(config), "client", NOW)).toMatchObject({ savedDepositCents: 4000 });
    const rows = (await credits(appt)).map((r) => [r.categoryId, r.serviceId, r.amountCents]);
    expect(rows).toEqual([
      [ids.cejas, null, 1500],
      [ids.pestanas, null, 2000],
      [null, ids.suelto, 500],
    ]);
  });

  it("si las partes ya no suman lo pagado, se guarda todo junto", async () => {
    const appt = await bookedAppointment([ids.lam], 1200); // se pagó 12 €; hoy el servicio pide 15 €
    await cancelAppointment(appt, toChangeOptions(config), "client", NOW);
    expect((await credits(appt)).map((r) => [r.categoryId, r.amountCents])).toEqual([[ids.cejas, 1200]]);
  });

  it("el cobrador es el del pago con tarjeta o, si no lo hubo, el de la profesional", async () => {
    const byStaff = await bookedAppointment([ids.lam], 1500, { staffId: ids.luz });
    await cancelAppointment(byStaff, toChangeOptions(config), "client", NOW);
    expect((await credits(byStaff))[0].collector).toBe("luz");

    const byCard = await bookedAppointment([ids.lam], 1500, { staffId: ids.luz });
    await db.insert(payment).values({
      appointmentId: byCard, collector: "salon", environment: "test", merchantCode: "999008881", terminal: 1,
      orderCode: "1234Credit01", amountCents: 1500, status: "paid", notifiedAt: NOW,
    });
    await cancelAppointment(byCard, toChangeOptions(config), "client", NOW);
    expect((await credits(byCard))[0].collector).toBe("salon");
  });

  it("no se guarda nada si no estaba pagado, si se devolvió o si el salón no guarda depósitos", async () => {
    const pending = await bookedAppointment([ids.lam], 1500, { status: "pending_deposit" });
    expect(await cancelAppointment(pending, toChangeOptions(config), "client", NOW)).toEqual({ ok: true });
    expect(await credits(pending)).toHaveLength(0);

    const refunded = await bookedAppointment([ids.lam], 1500);
    await db.insert(payment).values({
      appointmentId: refunded, collector: "salon", environment: "test", merchantCode: "999008881", terminal: 1,
      orderCode: "1234Credit02", amountCents: 1500, status: "refunded", notifiedAt: NOW, refundedAt: NOW,
    });
    expect(await cancelAppointment(refunded, toChangeOptions(config), "client", NOW)).toEqual({ ok: true });
    expect(await credits(refunded)).toHaveLength(0);

    const notSaving = await bookedAppointment([ids.lam], 1500);
    expect(await cancelAppointment(notSaving, toChangeOptions(noSaving), "client", NOW)).toEqual({ ok: true });
    expect(await credits(notSaving)).toHaveLength(0);
  });

  it("si anula el equipo, solo se guarda cuando lo marca", async () => {
    const kept = await bookedAppointment([ids.lam], 1500);
    expect(
      await cancelAppointment(kept, toChangeOptions(config), "staff", NOW, { keepDeposit: true }),
    ).toMatchObject({ savedDepositCents: 1500 });
    const lost = await bookedAppointment([ids.lam], 1500);
    expect(await cancelAppointment(lost, toChangeOptions(config), "staff", NOW, { keepDeposit: false })).toEqual({
      ok: true,
    });
    expect(await credits(lost)).toHaveLength(0);
  });

  it("anular dos veces no guarda dos veces", async () => {
    const appt = await bookedAppointment([ids.lam], 1500);
    await cancelAppointment(appt, toChangeOptions(config), "client", NOW);
    expect(await cancelAppointment(appt, toChangeOptions(config), "client", NOW)).toEqual({
      ok: false,
      reason: "not_changeable",
    });
    expect(await credits(appt)).toHaveLength(1);
  });
});
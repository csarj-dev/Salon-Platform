import "./test-env"; // tiene que ser el primer import
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, pgClient } from "../db";
import {
  appointment, client, depositCode, depositCredit, location, locationService, schedule, service, serviceCategory,
  staff, staffService, timeOff,
} from "../db/schema";
import { createAppointment, type BookingOptions } from "../lib/booking";
import {
  MAX_ATTEMPTS, checkDepositProof, maskEmail, requestDepositCode, verifyDepositCode,
} from "../lib/deposit-codes";
import { depositPartsFor, matchSavedDeposits } from "../lib/deposit-credits";
import { salonConfigSchema } from "../lib/salon-config";

const config = salonConfigSchema.parse({
  name: "Salón de prueba",
  timezone: "Atlantic/Canary",
  locales: ["es"],
  defaultLocale: "es",
  contact: { whatsapp: "34600000000" },
  booking: { deposit: { saved: { months: 6 } } },
  payments: { defaultCollector: "salon", collectors: { salon: { label: "Salón" }, luz: { label: "Luz" } } },
});

const opts: BookingOptions = { zone: "Atlantic/Canary", stepMin: 30, bufferMin: 0, minNoticeHours: 2, maxDaysAhead: 60 };
const NOW = new Date("2026-11-19T10:00:00Z");
const PHONE = "600444555";
const EMAIL = "guardado.test@example.com";
// Lunes 30 de noviembre de 2026 (Canarias en invierno: UTC+0)
const at = (hhmm: string) => new Date(`2026-11-30T${hhmm}:00Z`);

let ids: { loc: number; ana: number; luz: number; client: number; cejas: number; pestanas: number; lam: number; lift: number };

async function wipe() {
  await db.delete(appointment);
  await db.delete(timeOff);
  await db.delete(schedule);
  await db.delete(locationService);
  await db.delete(staffService);
  await db.delete(client); // se lleva los códigos
  await db.delete(staff);
  await db.delete(service);
  await db.delete(location);
}

// Un depósito guardado de la clienta, salido de una cita anulada con ese correo
let slot = 0;
async function savedCredit(
  opts: { categoryId?: number; amountCents?: number; collector?: string; email?: string; expiresAt?: Date } = {},
) {
  const startsAt = new Date(Date.UTC(2026, 10, 1, 8) + slot++ * 3 * 3_600_000);
  const [source] = await db
    .insert(appointment)
    .values({
      clientId: ids.client, clientName: "Clienta", clientEmail: opts.email ?? EMAIL, serviceId: ids.lam,
      staffId: ids.ana, locationId: ids.loc, startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000),
      status: "cancelled", priceAppliedCents: 4500, source: "web", depositCents: 1500, cancelledAt: NOW,
    })
    .returning({ id: appointment.id });
  const [credit] = await db
    .insert(depositCredit)
    .values({
      clientId: ids.client, sourceAppointmentId: source.id, amountCents: opts.amountCents ?? 1500,
      categoryId: opts.categoryId ?? ids.cejas, collector: opts.collector ?? "salon",
      createdAt: new Date(NOW.getTime() - 86_400_000), expiresAt: opts.expiresAt ?? new Date("2027-05-01T00:00:00Z"),
    })
    .returning({ id: depositCredit.id });
  return credit.id;
}

const request = (serviceIds = [ids.lam], staffId = ids.ana, phone = PHONE, email = EMAIL, now = NOW) =>
  requestDepositCode({ phone, email, serviceIds, staffId }, config, now);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await wipe();
  const [l] = await db.insert(location).values({ name: "Local de prueba" }).returning();
  const [cejas, pestanas] = await db
    .insert(serviceCategory)
    .values([{ name: "Cejas (test codes)" }, { name: "Pestañas (test codes)" }])
    .returning();
  const [lam, lift] = await db
    .insert(service)
    .values([
      { name: "Laminado", durationMin: 60, priceCents: 4500, depositCents: 1500, categoryId: cejas.id },
      { name: "Lifting", durationMin: 60, priceCents: 5500, depositCents: 2000, categoryId: pestanas.id },
    ])
    .returning();
  const [ana, luz] = await db.insert(staff).values([{ name: "Ana" }, { name: "Luz", collector: "luz" }]).returning();
  await db.insert(locationService).values([lam, lift].map((s) => ({ locationId: l.id, serviceId: s.id })));
  await db.insert(staffService).values([lam, lift].map((s) => ({ staffId: ana.id, serviceId: s.id })));
  // Lunes de 9:00 a 18:00
  await db.insert(schedule).values({ staffId: ana.id, locationId: l.id, weekday: 1, startTime: "09:00", endTime: "18:00" });
  const [c] = await db.insert(client).values({ name: "Clienta", phone: PHONE, email: EMAIL }).returning();
  ids = { loc: l.id, ana: ana.id, luz: luz.id, client: c.id, cejas: cejas.id, pestanas: pestanas.id, lam: lam.id, lift: lift.id };
});

beforeEach(async () => {
  await db.delete(appointment); // se lleva los depósitos guardados
  await db.delete(depositCode);
});

afterAll(async () => {
  await wipe();
  await db.delete(serviceCategory).where(eq(serviceCategory.id, ids.cejas));
  await db.delete(serviceCategory).where(eq(serviceCategory.id, ids.pestanas));
  await pgClient.end();
});

describe("matchSavedDeposits", () => {
  it("cubre cada parte con uno de la misma categoría y cobrador; si falta una, nada", async () => {
    const cejasCredit = await savedCredit();
    const cejas = await depositPartsFor([ids.lam]);
    expect(await matchSavedDeposits(ids.client, cejas, "salon", EMAIL, NOW)).toEqual({ creditIds: [cejasCredit], cents: 1500 });
    // cejas + pestañas: falta el de pestañas
    expect(await matchSavedDeposits(ids.client, await depositPartsFor([ids.lam, ids.lift]), "salon", EMAIL, NOW)).toBeNull();
    // otro cobrador, otro correo, o ya caducado
    expect(await matchSavedDeposits(ids.client, cejas, "luz", EMAIL, NOW)).toBeNull();
    expect(await matchSavedDeposits(ids.client, cejas, "salon", "otra@example.com", NOW)).toBeNull();
    expect(await matchSavedDeposits(ids.client, cejas, "salon", EMAIL, new Date("2027-06-01T00:00:00Z"))).toBeNull();
  });

  it("uno más pequeño que lo que pide la parte no la cubre", async () => {
    await savedCredit({ amountCents: 1000 });
    expect(await matchSavedDeposits(ids.client, await depositPartsFor([ids.lam]), "salon", EMAIL, NOW)).toBeNull();
  });
});

describe("pedir y comprobar el código", () => {
  it("sin depósito que valga, la misma respuesta para todos", async () => {
    expect(await request()).toEqual({ ok: false, reason: "none" });
    await savedCredit();
    expect(await request([ids.lam], ids.ana, "699999999")).toEqual({ ok: false, reason: "none" });
    expect(await request([ids.lam], ids.ana, PHONE, "otra@example.com")).toEqual({ ok: false, reason: "none" });
    expect(await request([ids.lam], ids.luz)).toEqual({ ok: false, reason: "none" }); // Luz cobra aparte
    expect(await db.select().from(depositCode)).toHaveLength(0);
  });

  it("con depósito: código de 6 cifras que vale 10 minutos; solo se guarda su resumen", async () => {
    await savedCredit();
    const r = await request();
    if (!r.ok) throw new Error(r.reason);
    expect(r.code).toMatch(/^\d{6}$/);
    expect(r).toMatchObject({ maskedEmail: "g•••@example.com", cents: 1500, expiresAt: new Date(NOW.getTime() + 600_000) });
    const [row] = await db.select().from(depositCode);
    expect(row.codeHash).not.toContain(r.code);
    expect(maskEmail("ana@example.com")).toBe("a•••@example.com");
  });

  it("el código bueno da una prueba que vale una vez para esa clienta", async () => {
    await savedCredit();
    const r = await request();
    if (!r.ok) throw new Error(r.reason);
    const v = await verifyDepositCode(r.requestId, ` ${r.code.slice(0, 3)} ${r.code.slice(3)} `, NOW);
    if (!v.ok) throw new Error(v.reason);
    expect(await checkDepositProof(v.proof, PHONE, NOW)).toMatchObject({ ok: true, clientId: ids.client, email: EMAIL });
    expect(await checkDepositProof(v.proof, "699999999", NOW)).toEqual({ ok: false });
    expect(await checkDepositProof(v.proof, PHONE, new Date(NOW.getTime() + 31 * 60_000))).toEqual({ ok: false });
    // Comprobarlo otra vez ya no vale
    expect(await verifyDepositCode(r.requestId, r.code, NOW)).toEqual({ ok: false, reason: "expired" });
  });

  it("caduca a los 10 minutos", async () => {
    await savedCredit();
    const r = await request();
    if (!r.ok) throw new Error(r.reason);
    expect(await verifyDepositCode(r.requestId, r.code, new Date(NOW.getTime() + 11 * 60_000))).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("5 fallos bloquean 10 minutos: ni comprobar ni pedir otro", async () => {
    await savedCredit();
    const r = await request();
    if (!r.ok) throw new Error(r.reason);
    const wrong = r.code === "000000" ? "111111" : "000000";
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      expect(await verifyDepositCode(r.requestId, wrong, NOW)).toEqual({ ok: false, reason: "wrong", attemptsLeft: MAX_ATTEMPTS - i });
    }
    const until = new Date(NOW.getTime() + 600_000);
    expect(await verifyDepositCode(r.requestId, wrong, NOW)).toEqual({ ok: false, reason: "locked", until });
    expect(await verifyDepositCode(r.requestId, r.code, NOW)).toEqual({ ok: false, reason: "locked", until });
    expect(await request()).toEqual({ ok: false, reason: "locked", until });
    // Pasado el bloqueo se puede pedir otro
    expect((await request([ids.lam], ids.ana, PHONE, EMAIL, new Date(until.getTime() + 1000))).ok).toBe(true);
  });

  it("no más de 3 códigos cada 10 minutos", async () => {
    await savedCredit();
    for (let i = 0; i < 3; i++) expect((await request([ids.lam], ids.ana, PHONE, EMAIL, new Date(NOW.getTime() + i * 60_000))).ok).toBe(true);
    expect(await request([ids.lam], ids.ana, PHONE, EMAIL, new Date(NOW.getTime() + 3 * 60_000))).toEqual({
      ok: false,
      reason: "locked",
      until: new Date(NOW.getTime() + 600_000),
    });
  });
});

describe("reservar con el depósito guardado", () => {
  async function verifiedUse() {
    const creditId = await savedCredit();
    const r = await request();
    if (!r.ok) throw new Error(r.reason);
    const v = await verifyDepositCode(r.requestId, r.code, NOW);
    if (!v.ok) throw new Error(v.reason);
    const check = await checkDepositProof(v.proof, PHONE, NOW);
    if (!check.ok) throw new Error("prueba");
    return { creditId, codeId: check.codeId };
  }
  const input = (startsAt: Date) => ({
    locationId: ids.loc, staffId: ids.ana, serviceIds: [ids.lam], startsAt, source: "web" as const,
    consent: true, depositTermsAccepted: true, client: { name: "Clienta", phone: PHONE, email: EMAIL },
  });

  it("la cita sale confirmada y pagada; el depósito y el código quedan gastados", async () => {
    const { creditId, codeId } = await verifiedUse();
    const r = await createAppointment(input(at("10:00")), { ...opts, savedDeposit: { creditIds: [creditId], codeId } }, NOW);
    if (!r.ok) throw new Error(r.reason);
    expect(r).toMatchObject({ status: "booked", deposit: null, paidWithSavedDeposit: true });
    const [appt] = await db.select().from(appointment).where(eq(appointment.id, r.appointmentId));
    expect(appt).toMatchObject({ status: "booked", depositCents: 1500, depositPaidAt: NOW, depositDueAt: null });
    const [credit] = await db.select().from(depositCredit).where(eq(depositCredit.id, creditId));
    expect(credit).toMatchObject({ usedAt: NOW, usedAppointmentId: r.appointmentId });
    const [code] = await db.select().from(depositCode).where(eq(depositCode.id, codeId));
    expect(code.consumedAt).toEqual(NOW);
  });

  it("no se puede usar dos veces: la segunda reserva no se crea", async () => {
    const { creditId, codeId } = await verifiedUse();
    const use = { ...opts, savedDeposit: { creditIds: [creditId], codeId } };
    expect((await createAppointment(input(at("10:00")), use, NOW)).ok).toBe(true);
    expect(await createAppointment(input(at("12:00")), use, NOW)).toEqual({ ok: false, reason: "saved_deposit_gone" });
    const rows = await db.select().from(appointment).where(eq(appointment.startsAt, at("12:00")));
    expect(rows).toHaveLength(0);
  });
});
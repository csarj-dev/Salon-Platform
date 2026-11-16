import "./test-env"; // tiene que ser el primer import
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { asc, eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, pgClient } from "../db";
import { user } from "../db/auth-schema";
import {
  appointment, appointmentService, client, koiboxServiceMap, location, locationService, schedule,
  service, serviceCategory, staff, staffService, timeOff,
} from "../db/schema";
import type { SnapshotLoader } from "../lib/availability-koibox";
import { createKoiboxClient, type KoiboxApi } from "../lib/koibox/client";
import { createFakeKoibox, type FakeKoibox } from "../lib/koibox/fake";
import { RateLimiter } from "../lib/koibox/limits";
import { loadKoiboxSnapshot } from "../lib/koibox/snapshot";
import { KOIBOX_STATUS } from "../lib/koibox/statuses";
import { pushNewWebBooking, type KoiboxApiFor } from "../lib/koibox-sync";
import { salonConfigSchema } from "../lib/salon-config";
import { createStaffAppointment, findClientByPhone, type StaffBookingInput } from "../lib/staff-booking";

const config = salonConfigSchema.parse({
  name: "Salón de prueba",
  timezone: "Atlantic/Canary",
  locales: ["es"],
  defaultLocale: "es",
  booking: { availability: "koibox" },
  koibox: { accounts: { salon: { label: "Salón", keyEnv: "KOIBOX_KEY_SALON" } } },
});

const RECEPTION = "staff-booking-test-user";
const NOW = new Date("2026-10-29T10:00:00Z");
const MON = "2026-11-02"; // lunes; en Canarias, UTC+0
const at = (hhmm: string) => new Date(`${MON}T${hhmm}:00Z`);

let ids: { loc: number; lam: number; dis: number; lif: number; lucia: number; cats: number[] };
let fake: FakeKoibox;
let api: KoiboxApi;
let apiFor: KoiboxApiFor;
let loadFresh: SnapshotLoader;

async function wipe() {
  await db.delete(appointment);
  await db.delete(timeOff);
  await db.delete(schedule);
  await db.delete(locationService);
  await db.delete(staffService);
  await db.delete(client);
  await db.delete(staff);
  await db.delete(service); // sus ids de Koibox caen en cascada
  await db.delete(location);
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await wipe();
  await db
    .insert(user)
    .values({ id: RECEPTION, name: "Recepción Test", email: "recepcion.staffbooking@example.com" })
    .onConflictDoNothing();

  const [cejas, pestanas] = await db
    .insert(serviceCategory)
    .values([{ name: "Cejas (test)" }, { name: "Pestañas (test)" }])
    .returning();
  const [lam, dis, lif] = await db
    .insert(service)
    .values([
      { name: "Laminado de cejas", durationMin: 60, priceCents: 4500, categoryId: cejas.id, depositCents: 1500 },
      { name: "Diseño de cejas", durationMin: 30, priceCents: 2000, categoryId: cejas.id, depositCents: 1500 },
      { name: "Lifting de pestañas", durationMin: 75, priceCents: 5500, categoryId: pestanas.id, depositCents: 2000 },
    ])
    .returning();
  const [loc] = await db.insert(location).values({ name: "Staff booking test", slug: "staff-booking-test" }).returning();
  const [lucia] = await db.insert(staff).values({ name: "Lucía", koiboxAccount: "salon", koiboxUserId: 11 }).returning();

  await db.insert(locationService).values([
    { locationId: loc.id, serviceId: lam.id },
    { locationId: loc.id, serviceId: dis.id, priceCents: 1800 }, // precio propio del local
    { locationId: loc.id, serviceId: lif.id },
  ]);
  // Lucía no hace el lifting
  await db.insert(staffService).values([
    { staffId: lucia.id, serviceId: lam.id },
    { staffId: lucia.id, serviceId: dis.id },
  ]);
  await db.insert(koiboxServiceMap).values([
    { serviceId: lam.id, account: "salon", koiboxServiceId: 501 },
    { serviceId: dis.id, account: "salon", koiboxServiceId: 502 },
  ]);
  ids = { loc: loc.id, lam: lam.id, dis: dis.id, lif: lif.id, lucia: lucia.id, cats: [cejas.id, pestanas.id] };
}, 30_000);

beforeEach(async () => {
  await db.delete(appointment);
  await db.delete(client);
  fake = createFakeKoibox({
    salon: {
      users: [{ id: 11, name: "Lucía", from: "09:00", to: "20:00" }],
      services: [
        { id: 501, name: "Laminado", duration: "01:00:00", userIds: [11] },
        { id: 502, name: "Diseño", duration: "00:30:00", userIds: [11] },
      ],
      clients: [{ id: 900, nombre: "Marta", movil: "611 222 333" }],
    },
  });
  api = createKoiboxClient({ apiKey: "salon", fetchImpl: fake.fetch, limiter: new RateLimiter(1000) });
  apiFor = () => api;
  loadFresh = (_account, from, to) => loadKoiboxSnapshot(api, from, to);
});

afterAll(async () => {
  await wipe();
  await db.delete(serviceCategory).where(inArray(serviceCategory.id, ids.cats));
  await db.delete(user).where(eq(user.id, RECEPTION));
  await pgClient.end();
});

// Laminado + diseño a las 10:00, ajustado a 80 min (suman 90)
const book = (extra: Partial<StaffBookingInput> = {}) =>
  createStaffAppointment(
    {
      locationId: ids.loc,
      staffId: ids.lucia,
      serviceIds: [ids.lam, ids.dis],
      startsAt: at("10:00"),
      durationMin: 80,
      client: { name: "Carmen Vidal", phone: "622 111 222", email: "carmen@example.com" },
      deposit: "none",
      ...extra,
    },
    config,
    { userId: RECEPTION, now: NOW, loadFresh },
  );

const row = async (id: number) => (await db.select().from(appointment).where(eq(appointment.id, id)))[0];

describe("createStaffAppointment", () => {
  it("dos servicios seguidos con la duración que pone recepción; el precio es la suma", async () => {
    const r = await book();
    if (!r.ok) throw new Error(`Debía crearse: ${r.reason}`);
    expect(r).toMatchObject({ status: "booked", deposit: null });

    const a = await row(r.appointmentId);
    expect(a).toMatchObject({
      serviceId: ids.lam,
      startsAt: at("10:00"),
      endsAt: at("11:20"),
      priceAppliedCents: 4500 + 1800,
      status: "booked",
      source: "phone",
      depositCents: null,
    });
    const lines = await db
      .select()
      .from(appointmentService)
      .where(eq(appointmentService.appointmentId, r.appointmentId))
      .orderBy(asc(appointmentService.position));
    expect(lines.map((l) => [l.position, l.serviceId, l.durationMin, l.priceCents])).toEqual([
      [0, ids.lam, 60, 4500],
      [1, ids.dis, 30, 1800],
    ]);
  });

  it("depósito con enlace: los dos son de cejas, se pide uno; queda pendiente con su plazo", async () => {
    const r = await book({ deposit: "link" });
    if (!r.ok) throw new Error(`Debía crearse: ${r.reason}`);
    const dueAt = new Date("2026-10-30T10:00:00Z"); // 24 h desde NOW
    expect(r).toMatchObject({ status: "pending_deposit", deposit: { cents: 1500, dueAt } });
    expect(await row(r.appointmentId)).toMatchObject({ status: "pending_deposit", depositCents: 1500, depositDueAt: dueAt });
  });

  it("ya pagado: confirmada, con el importe y quién lo validó", async () => {
    const r = await book({ deposit: "paid" });
    if (!r.ok) throw new Error(`Debía crearse: ${r.reason}`);
    expect(await row(r.appointmentId)).toMatchObject({
      status: "booked",
      depositCents: 1500,
      depositPaidAt: NOW,
      depositValidatedBy: RECEPTION,
      depositDueAt: null,
    });
  });

  it("si se pisa con otra cita no se guarda, y dice con cuál", async () => {
    const first = await book();
    if (!first.ok) throw new Error("La primera debía crearse");
    const r = await book({
      startsAt: at("11:00"),
      durationMin: 60,
      client: { name: "Inés Ruiz", phone: "633444555" },
    });
    expect(r).toMatchObject({
      ok: false,
      reason: "clash",
      clash: { kind: "appointment", appointment: { id: first.appointmentId, clientName: "Carmen Vidal" } },
    });
  });

  it("una cita apuntada directamente en Koibox también bloquea", async () => {
    await api.createAppointment({
      titulo: "Hecha en Koibox",
      fecha: MON,
      hora_inicio: "12:00:00",
      hora_fin: "13:00:00",
      user: 11,
      cliente: 900,
      servicios: [501],
      estado: KOIBOX_STATUS.PENDING,
      notas: "",
      tags: [],
    });
    const r = await book({ startsAt: at("12:30"), durationMin: 30 });
    expect(r).toMatchObject({ ok: false, reason: "clash", clash: { kind: "koibox", startsAt: at("12:00") } });
  });

  it("fuera de turno avisa; si recepción lo confirma, se guarda", async () => {
    // Lucía trabaja hasta las 20:00 en Koibox
    expect(await book({ startsAt: at("19:30"), durationMin: 60 })).toEqual({
      ok: false,
      reason: "needs_confirmation",
      warnings: ["outside_shift"],
    });
    const forced = await book({ startsAt: at("19:30"), durationMin: 60, force: true });
    expect(forced.ok).toBe(true);
  });

  it("si la profesional no hace alguno de los servicios, no se guarda", async () => {
    expect(await book({ serviceIds: [ids.lam, ids.lif] })).toEqual({
      ok: false,
      reason: "service_not_done",
      serviceNames: ["Lifting de pestañas"],
    });
  });

  it("hora y duración van de 5 en 5 minutos", async () => {
    expect(await book({ durationMin: 82 })).toMatchObject({ ok: false, reason: "invalid_input" });
    expect(await book({ startsAt: at("10:02") })).toMatchObject({ ok: false, reason: "invalid_input" });
  });

  it("Koibox recibe los dos servicios, con la hora de fin que puso recepción", async () => {
    const r = await book();
    if (!r.ok) throw new Error("Debía crearse");
    const pushed = await pushNewWebBooking(r.appointmentId, config, { apiFor, now: NOW });
    expect(pushed).toEqual({ ok: true, synced: true });

    const [inKoibox] = await api.listAppointments({ from: MON, to: MON, userIds: [11] });
    expect(inKoibox).toMatchObject({
      titulo: "Laminado de cejas + Diseño de cejas",
      hora_inicio: "10:00:00",
      hora_fin: "11:20:00",
    });
  });
});

describe("findClientByPhone", () => {
  it("encuentra a la clienta aunque el teléfono lleve espacios o guiones, con sus citas", async () => {
    await book();
    expect(await findClientByPhone("622-111-222")).toMatchObject({
      name: "Carmen Vidal",
      email: "carmen@example.com",
      appointments: 1,
    });
  });

  it("un teléfono que no está, o que no es un teléfono, da null", async () => {
    expect(await findClientByPhone("699999999")).toBeNull();
    expect(await findClientByPhone("12")).toBeNull();
  });
});
import "./test-env"; // tiene que ser el primer import
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, pgClient } from "../db";
import {
  appointment, client, koiboxServiceMap, location, locationService, schedule,
  service, serviceCategory, staff, staffService, timeOff,
} from "../db/schema";
import type { SnapshotLoader } from "../lib/availability-koibox";
import { createKoiboxClient, type KoiboxApi } from "../lib/koibox/client";
import { createFakeKoibox, type FakeKoibox } from "../lib/koibox/fake";
import { RateLimiter } from "../lib/koibox/limits";
import { loadKoiboxSnapshot } from "../lib/koibox/snapshot";
import { KOIBOX_STATUS } from "../lib/koibox/statuses";
import { refId } from "../lib/koibox/types";
import { pushNewWebBooking, type KoiboxApiFor } from "../lib/koibox-sync";
import { moveAppointment, moveStaffAppointment, previewStaffMove, type StaffMoveInput } from "../lib/move-appointment";
import { salonConfigSchema } from "../lib/salon-config";
import { createStaffAppointment } from "../lib/staff-booking";

// Dos cuentas: Lucía en la del salón, Amanda en la suya
const config = salonConfigSchema.parse({
  name: "Salón de prueba",
  timezone: "Atlantic/Canary",
  locales: ["es"],
  defaultLocale: "es",
  booking: { availability: "koibox" },
  koibox: {
    accounts: {
      salon: { label: "Salón", keyEnv: "KOIBOX_KEY_SALON" },
      amanda: { label: "Amanda", keyEnv: "KOIBOX_KEY_AMANDA" },
    },
  },
});

const NOW = new Date("2026-10-29T10:00:00Z");
const MON = "2026-11-02"; // lunes; en Canarias, UTC+0
const at = (hhmm: string) => new Date(`${MON}T${hhmm}:00Z`);

let ids: { loc: number; lam: number; dis: number; lucia: number; amanda: number; cat: number };
let fake: FakeKoibox;
let apis: Record<string, KoiboxApi>;
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
  const [cejas] = await db.insert(serviceCategory).values({ name: "Cejas (move test)" }).returning();
  const [lam, dis] = await db
    .insert(service)
    .values([
      { name: "Laminado de cejas", durationMin: 60, priceCents: 4500, categoryId: cejas.id },
      { name: "Diseño de cejas", durationMin: 30, priceCents: 2000, categoryId: cejas.id },
    ])
    .returning();
  const [loc] = await db.insert(location).values({ name: "Staff move test", slug: "staff-move-test" }).returning();
  const [lucia, amanda] = await db
    .insert(staff)
    .values([
      { name: "Lucía", koiboxAccount: "salon", koiboxUserId: 11 },
      { name: "Amanda", koiboxAccount: "amanda", koiboxUserId: 7 },
    ])
    .returning();
  await db.insert(locationService).values([
    { locationId: loc.id, serviceId: lam.id },
    { locationId: loc.id, serviceId: dis.id },
  ]);
  // Amanda solo hace el laminado
  await db.insert(staffService).values([
    { staffId: lucia.id, serviceId: lam.id },
    { staffId: lucia.id, serviceId: dis.id },
    { staffId: amanda.id, serviceId: lam.id },
  ]);
  await db.insert(koiboxServiceMap).values([
    { serviceId: lam.id, account: "salon", koiboxServiceId: 501 },
    { serviceId: dis.id, account: "salon", koiboxServiceId: 502 },
    { serviceId: lam.id, account: "amanda", koiboxServiceId: 77 },
  ]);
  ids = { loc: loc.id, lam: lam.id, dis: dis.id, lucia: lucia.id, amanda: amanda.id, cat: cejas.id };
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
    },
    amanda: {
      users: [{ id: 7, name: "Amanda", from: "09:00", to: "20:00" }],
      services: [{ id: 77, name: "Laminado", duration: "01:00:00", userIds: [7] }],
    },
  });
  const make = (key: string) =>
    createKoiboxClient({ apiKey: key, fetchImpl: fake.fetch, limiter: new RateLimiter(1000) });
  apis = { salon: make("salon"), amanda: make("amanda") };
  apiFor = (account) => apis[account];
  loadFresh = (account, from, to) => loadKoiboxSnapshot(apis[account], from, to);
});

afterAll(async () => {
  await wipe();
  await db.delete(serviceCategory).where(inArray(serviceCategory.id, [ids.cat]));
  await pgClient.end();
});

// Una cita de recepción ya apuntada en Koibox (cuenta del salón, con Lucía)
async function booked(serviceIds: number[], hhmm: string, durationMin: number, name = "Carmen Vidal", phone = "622111222") {
  const r = await createStaffAppointment(
    {
      locationId: ids.loc,
      staffId: ids.lucia,
      serviceIds,
      startsAt: at(hhmm),
      durationMin,
      client: { name, phone },
      deposit: "none",
    },
    config,
    { userId: "nadie", now: NOW, loadFresh },
  );
  if (!r.ok) throw new Error(`No se pudo crear: ${r.reason}`);
  const pushed = await pushNewWebBooking(r.appointmentId, config, { apiFor, now: NOW });
  if (!pushed.ok) throw new Error("No se pudo apuntar en Koibox");
  return r.appointmentId;
}

const row = async (id: number) => (await db.select().from(appointment).where(eq(appointment.id, id)))[0];
const move = (id: number, change: Partial<StaffMoveInput> & { startsAt: Date }) =>
  moveStaffAppointment(id, { staffId: ids.lucia, durationMin: 60, ...change }, config, { now: NOW, apiFor, loadFresh });
// Citas de Koibox que siguen ocupando (no anuladas) de una cuenta ese lunes
const activeIn = async (account: string) =>
  (await apis[account].listAppointments({ from: MON, to: MON })).filter(
    (a) => refId(a.estado) !== KOIBOX_STATUS.CANCELLED,
  );

describe("moveStaffAppointment", () => {
  it("estirar y acortar: cambia la hora de fin aquí y en Koibox", async () => {
    const id = await booked([ids.lam], "10:00", 60);

    expect(await move(id, { startsAt: at("10:00"), durationMin: 90 })).toEqual({ ok: true, koibox: "synced" });
    expect((await row(id)).endsAt).toEqual(at("11:30"));
    expect((await activeIn("salon")).map((a) => a.hora_fin)).toEqual(["11:30:00"]);

    expect(await move(id, { startsAt: at("10:00"), durationMin: 45 })).toMatchObject({ ok: true });
    expect((await row(id)).endsAt).toEqual(at("10:45"));
    expect((await activeIn("salon")).map((a) => a.hora_fin)).toEqual(["10:45:00"]);
  });

  it("al moverla de hora conserva la duración que puso recepción", async () => {
    const id = await booked([ids.lam, ids.dis], "10:00", 80);
    expect(await move(id, { startsAt: at("12:00"), durationMin: 80 })).toMatchObject({ ok: true });
    expect(await row(id)).toMatchObject({ startsAt: at("12:00"), endsAt: at("13:20") });
  });

  it("cambia de profesional y de cuenta: se crea en la nueva y se anula en la vieja, con la nota del panel", async () => {
    const id = await booked([ids.lam], "10:00", 60);
    const oldKoiboxId = (await row(id)).koiboxAppointmentId!;

    expect(await move(id, { startsAt: at("12:00"), staffId: ids.amanda })).toEqual({ ok: true, koibox: "synced" });

    const after = await row(id);
    expect(after).toMatchObject({
      staffId: ids.amanda,
      koiboxAccount: "amanda",
      koiboxPreviousId: null,
      koiboxPreviousAccount: null,
    });
    expect((await activeIn("amanda")).map((a) => a.hora_inicio)).toEqual(["12:00:00"]);
    const old = await apis.salon.getAppointment(oldKoiboxId);
    expect(refId(old!.estado)).toBe(KOIBOX_STATUS.CANCELLED);
    expect(old!.notas).toContain("Cambiada de hora desde el panel");
  });

  it("si la nueva profesional no hace un servicio, no se mueve", async () => {
    const id = await booked([ids.lam, ids.dis], "10:00", 90);
    expect(await move(id, { startsAt: at("10:00"), staffId: ids.amanda, durationMin: 90 })).toEqual({
      ok: false,
      reason: "service_not_done",
      serviceNames: ["Diseño de cejas"],
    });
  });

  it("si se pisa con otra cita no se mueve, y dice con cuál", async () => {
    const first = await booked([ids.lam], "10:00", 60);
    const second = await booked([ids.lam], "12:00", 60, "Inés Ruiz", "633444555");
    expect(await move(second, { startsAt: at("10:30") })).toMatchObject({
      ok: false,
      reason: "clash",
      clash: { kind: "appointment", appointment: { id: first, clientName: "Carmen Vidal" } },
    });
    expect((await row(second)).startsAt).toEqual(at("12:00"));
  });

  it("fuera de turno avisa; si recepción lo confirma, se mueve", async () => {
    const id = await booked([ids.lam], "10:00", 60);
    expect(await move(id, { startsAt: at("19:30") })).toEqual({
      ok: false,
      reason: "needs_confirmation",
      warnings: ["outside_shift"],
    });
    expect(await move(id, { startsAt: at("19:30"), force: true })).toMatchObject({ ok: true });
  });

  it("sin cambios no hace nada", async () => {
    const id = await booked([ids.lam], "10:00", 60);
    expect(await move(id, { startsAt: at("10:00") })).toEqual({ ok: false, reason: "no_change" });
  });
});

describe("moveAppointment (la clienta) con la duración de recepción", () => {
  it("al cambiar de hora conserva la duración de la cita, no la del servicio", async () => {
    const id = await booked([ids.lam], "10:00", 80);
    const r = await moveAppointment(id, at("14:00"), config, { actor: "staff", now: NOW, apiFor, loadFresh });
    expect(r).toMatchObject({ ok: true });
    expect(await row(id)).toMatchObject({ startsAt: at("14:00"), endsAt: at("15:20") });
  });
});

describe("previewStaffMove (el diálogo antes de confirmar)", () => {
  const preview = (id: number, change: Partial<StaffMoveInput> & { startsAt: Date }) =>
    previewStaffMove(id, { staffId: ids.lucia, durationMin: 60, ...change }, config, { now: NOW, loadFresh });

  it("dice los avisos y no mueve nada", async () => {
    const id = await booked([ids.lam], "10:00", 60);
    expect(await preview(id, { startsAt: at("19:30") })).toEqual({
      ok: true,
      warnings: ["outside_shift"],
      accountChange: null,
    });
    expect(await row(id)).toMatchObject({ startsAt: at("10:00"), endsAt: at("11:00") });
  });

  it("si cambia de profesional y de cuenta de Koibox, lo dice", async () => {
    const id = await booked([ids.lam], "10:00", 60);
    expect(await preview(id, { startsAt: at("12:00"), staffId: ids.amanda })).toEqual({
      ok: true,
      warnings: [],
      accountChange: { from: "salon", to: "amanda" },
    });
  });

  it("si se pisa con otra cita, lo dice igual que al mover", async () => {
    await booked([ids.lam], "10:00", 60);
    const second = await booked([ids.lam], "12:00", 60, "Inés Ruiz", "633444555");
    expect(await preview(second, { startsAt: at("10:30") })).toMatchObject({
      ok: false,
      reason: "clash",
      clash: { kind: "appointment", appointment: { clientName: "Carmen Vidal" } },
    });
  });
});
import "./test-env"; // tiene que ser el primer import
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, pgClient } from "../db";
import {
  appointment, client, koiboxServiceMap, location, locationService, schedule,
  service, staff, staffService, timeOff,
} from "../db/schema";
import {
  KoiboxUnavailableError,
  confirmKoiboxSlot,
  getKoiboxAvailabilityForRange,
  type SnapshotLoader,
} from "../lib/availability-koibox";
import type { AvailabilityOptions } from "../lib/availability-db";
import { createAppointment, type BookingOptions } from "../lib/booking";
import { createKoiboxClient, type KoiboxApi } from "../lib/koibox/client";
import { createFakeKoibox, type FakeKoibox } from "../lib/koibox/fake";
import { RateLimiter } from "../lib/koibox/limits";
import { loadKoiboxSnapshot } from "../lib/koibox/snapshot";
import { KOIBOX_STATUS } from "../lib/koibox/statuses";
import type { KoiboxConfig } from "../lib/salon-config";

const opts: AvailabilityOptions = { zone: "Atlantic/Canary", stepMin: 30, bufferMin: 0, minNoticeHours: 2 };
const NOW = new Date("2026-10-29T10:00:00Z");
const MON = "2026-11-02"; // lunes; en Canarias, UTC+0
const at = (hhmm: string) => new Date(`${MON}T${hhmm}:00Z`);
const hhmm = (d: Date) => d.toISOString().slice(11, 16);

const koibox: KoiboxConfig = {
  accounts: {
    salon: { label: "Salón", keyEnv: "KOIBOX_KEY_SALON", locations: ["koibox-test"] },
    amanda: { label: "Amanda", keyEnv: "KOIBOX_KEY_AMANDA", locations: ["koibox-test"] },
    luz: { label: "Luz", keyEnv: "KOIBOX_KEY_LUZ", locations: ["otro-local"] },
  },
};

let fake: FakeKoibox;
let apis: Record<string, KoiboxApi>;
let calls: string[];
const load: SnapshotLoader = (account, from, to) => {
  calls.push(account);
  return loadKoiboxSnapshot(apis[account], from, to);
};

let ids: { loc: number; svc: number; lucia: number; amanda: number; luz: number; nerea: number };

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

  const [loc] = await db.insert(location).values({ name: "Koibox test", slug: "koibox-test" }).returning();
  const [svc] = await db.insert(service).values({ name: "Lifting", durationMin: 60, priceCents: 4500 }).returning();
  const team = await db
    .insert(staff)
    .values([
      { name: "Lucía", koiboxAccount: "salon", koiboxUserId: 11 },
      { name: "Amanda", koiboxAccount: "amanda", koiboxUserId: 7 },
      { name: "Luz", koiboxAccount: "luz", koiboxUserId: 3 }, // su cuenta trabaja en otro local
      { name: "Nerea" }, // sin enlazar
    ])
    .returning();
  const [lucia, amanda, luz, nerea] = team.map((m) => m.id);

  await db.insert(locationService).values({ locationId: loc.id, serviceId: svc.id });
  await db.insert(staffService).values(team.map((m) => ({ staffId: m.id, serviceId: svc.id })));
  await db.insert(koiboxServiceMap).values([
    { serviceId: svc.id, account: "salon", koiboxServiceId: 501 },
    { serviceId: svc.id, account: "amanda", koiboxServiceId: 77 },
    { serviceId: svc.id, account: "luz", koiboxServiceId: 9 },
  ]);
  // A propósito NO hay turnos en nuestra tabla `schedule`: en modo Koibox salen de Koibox
  ids = { loc: loc.id, svc: svc.id, lucia, amanda, luz, nerea };
}, 30_000);

beforeEach(async () => {
  await db.delete(appointment);
  await db.delete(client);
  calls = [];
  fake = createFakeKoibox({
    salon: {
      users: [{ id: 11, name: "Lucía", from: "10:00", to: "12:00" }],
      services: [{ id: 501, name: "Lifting", duration: "01:00:00", userIds: [11] }],
      clients: [{ id: 900, nombre: "Laura", movil: "600000000" }],
    },
    amanda: {
      users: [{ id: 7, name: "Amanda", from: "11:00", to: "13:00" }],
      services: [{ id: 77, name: "Lifting", duration: "01:00:00", userIds: [7] }],
    },
    luz: {
      users: [{ id: 3, name: "Luz", from: "09:00", to: "20:00" }],
      services: [{ id: 9, name: "Lifting", duration: "01:00:00", userIds: [3] }],
    },
  });
  const makeApi = (key: string) => createKoiboxClient({ apiKey: key, fetchImpl: fake.fetch, limiter: new RateLimiter(1000) });
  apis = { salon: makeApi("salon"), amanda: makeApi("amanda"), luz: makeApi("luz") };
});

afterAll(async () => {
  await wipe();
  await pgClient.end();
});

describe("getKoiboxAvailabilityForRange", () => {
  it("calcula los huecos con los turnos de Koibox, solo con las enlazadas de este local", async () => {
    const r = await getKoiboxAvailabilityForRange(ids.loc, ids.svc, MON, MON, opts, NOW, koibox, load);
    const day = r.get(MON)!;
    expect(day.perStaff.map((s) => [s.staffName, s.slots.map(hhmm)])).toEqual([
      ["Amanda", ["11:00", "11:30", "12:00"]],
      ["Lucía", ["10:00", "10:30", "11:00"]],
    ]);
    // Ni Luz (otro local) ni Nerea (sin enlazar). Una descarga por cuenta implicada.
    expect(calls.sort()).toEqual(["amanda", "salon"]);
  });

  it("un día lleno en Koibox no aparece", async () => {
    for (const [hora_inicio, hora_fin] of [["10:00:00", "11:00:00"], ["11:00:00", "12:00:00"]]) {
      await apis.salon.createAppointment({
        titulo: "Recepción", fecha: MON, hora_inicio, hora_fin, user: 11, cliente: 900, servicios: [501],
        estado: KOIBOX_STATUS.PENDING,
      });
    }
    const onlyLucia: KoiboxConfig = { accounts: { salon: koibox.accounts.salon } };
    const r = await getKoiboxAvailabilityForRange(ids.loc, ids.svc, MON, "2026-11-03", opts, NOW, onlyLucia, load);
    expect(r.has(MON)).toBe(false);
    expect(r.has("2026-11-03")).toBe(true);
  });

  it("si Koibox falla, lanza KoiboxUnavailableError", async () => {
    fake.failNext(503, 20);
    await expect(
      getKoiboxAvailabilityForRange(ids.loc, ids.svc, MON, MON, opts, NOW, koibox, (a, f, t) =>
        loadKoiboxSnapshot(createKoiboxClient({ apiKey: a, fetchImpl: fake.fetch, maxRetries: 0, limiter: new RateLimiter(1000) }), f, t),
      ),
    ).rejects.toBeInstanceOf(KoiboxUnavailableError);
  });
});

describe("confirmKoiboxSlot", () => {
  it("con una profesional concreta, la devuelve si sigue libre", async () => {
    expect(await confirmKoiboxSlot(ids.loc, ids.svc, ids.lucia, at("10:00"), opts, NOW, koibox, load)).toBe(ids.lucia);
    expect(calls).toEqual(["salon"]); // solo su cuenta
  });

  it("con 'cualquiera', asigna la primera libre a esa hora", async () => {
    expect(await confirmKoiboxSlot(ids.loc, ids.svc, "any", at("12:00"), opts, NOW, koibox, load)).toBe(ids.amanda);
  });

  it("si recepción ocupó la hora en Koibox, ya no está libre", async () => {
    await apis.salon.createAppointment({
      titulo: "Recepción", fecha: MON, hora_inicio: "10:00:00", hora_fin: "11:00:00", user: 11, cliente: 900,
      servicios: [501], estado: KOIBOX_STATUS.PENDING,
    });
    expect(await confirmKoiboxSlot(ids.loc, ids.svc, ids.lucia, at("10:00"), opts, NOW, koibox, load)).toBeNull();
  });

  it("no vale para profesionales sin enlazar o de otro local", async () => {
    expect(await confirmKoiboxSlot(ids.loc, ids.svc, ids.nerea, at("10:00"), opts, NOW, koibox, load)).toBeNull();
    expect(await confirmKoiboxSlot(ids.loc, ids.svc, ids.luz, at("10:00"), opts, NOW, koibox, load)).toBeNull();
  });
});

describe("createAppointment en modo Koibox", () => {
  const bookingOpts: BookingOptions = { ...opts, maxDaysAhead: 60, availability: "koibox" };
  const input = (staffId: number, startsAt: Date) => ({
    locationId: ids.loc,
    serviceId: ids.svc,
    staffId,
    startsAt,
    source: "web",
    consent: true,
    client: { name: "Clienta Test", phone: "600111222" },
  });

  it("reserva aunque no haya turnos en nuestra tabla (los turnos están en Koibox)", async () => {
    const r = await createAppointment(input(ids.lucia, at("10:00")), bookingOpts, NOW);
    expect(r.ok).toBe(true);
  });

  it("sigue impidiendo dos citas a la vez de la misma profesional", async () => {
    expect((await createAppointment(input(ids.lucia, at("10:00")), bookingOpts, NOW)).ok).toBe(true);
    const again = await createAppointment({ ...input(ids.lucia, at("10:30")), client: { name: "Otra", phone: "600999888" } }, bookingOpts, NOW);
    expect(again).toEqual({ ok: false, reason: "slot_taken" });
  });

  it("respeta la antelación mínima", async () => {
    const r = await createAppointment(input(ids.lucia, at("10:00")), bookingOpts, new Date(`${MON}T09:00:00Z`));
    expect(r).toEqual({ ok: false, reason: "slot_unavailable" });
  });

  it("rechaza a una profesional que no hace el servicio", async () => {
    const [other] = await db.insert(staff).values({ name: "Koibox test externa" }).returning();
    const r = await createAppointment(input(other.id, at("10:00")), bookingOpts, NOW);
    expect(r).toEqual({ ok: false, reason: "slot_unavailable" });
  });
});
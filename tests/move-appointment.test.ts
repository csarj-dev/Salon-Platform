import "./test-env"; // tiene que ser el primer import
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, pgClient } from "../db";
import {
  appointment, client, emailLog, koiboxServiceMap, location, locationService, schedule,
  service, staff, staffService, timeOff,
} from "../db/schema";
import type { SnapshotLoader } from "../lib/availability-koibox";
import { createAppointment, type BookingOptions } from "../lib/booking";
import { createKoiboxClient, type KoiboxApi } from "../lib/koibox/client";
import { createFakeKoibox, type FakeKoibox } from "../lib/koibox/fake";
import { KoiboxError, RateLimiter } from "../lib/koibox/limits";
import { koiboxWorkFor } from "../lib/koibox/pending";
import { loadKoiboxSnapshot } from "../lib/koibox/snapshot";
import { KOIBOX_STATUS } from "../lib/koibox/statuses";
import { pushAppointmentToKoibox, syncPendingKoibox, type KoiboxApiFor } from "../lib/koibox-sync";
import { moveAppointment } from "../lib/move-appointment";
import { salonConfigSchema } from "../lib/salon-config";

const config = salonConfigSchema.parse({
  name: "Salón de prueba",
  timezone: "Atlantic/Canary",
  locales: ["es"],
  defaultLocale: "es",
  booking: { availability: "koibox" },
  koibox: { accounts: { salon: { label: "Salón", keyEnv: "KOIBOX_KEY_SALON" } } },
});

const bookingOpts: BookingOptions = {
  zone: "Atlantic/Canary",
  stepMin: 30,
  bufferMin: 0,
  minNoticeHours: 2,
  maxDaysAhead: 60,
  depositHoldHours: 24,
  availability: "koibox",
};

const NOW = new Date("2026-10-29T10:00:00Z");
const MON = "2026-11-02"; // lunes; en Canarias, UTC+0
const at = (hhmm: string) => new Date(`${MON}T${hhmm}:00Z`);

let ids: { loc: number; laminado: number; lucia: number };
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
  const [loc] = await db.insert(location).values({ name: "Move test", slug: "move-test" }).returning();
  const [laminado] = await db
    .insert(service)
    .values({ name: "Laminado de cejas", durationMin: 60, priceCents: 4500 })
    .returning();
  const [lucia] = await db.insert(staff).values({ name: "Lucía", koiboxAccount: "salon", koiboxUserId: 11 }).returning();
  await db.insert(locationService).values({ locationId: loc.id, serviceId: laminado.id });
  await db.insert(staffService).values({ staffId: lucia.id, serviceId: laminado.id });
  await db.insert(koiboxServiceMap).values({ serviceId: laminado.id, account: "salon", koiboxServiceId: 501 });
  ids = { loc: loc.id, laminado: laminado.id, lucia: lucia.id };
}, 30_000);

beforeEach(async () => {
  await db.delete(appointment);
  await db.delete(client);
  fake = createFakeKoibox({
    salon: {
      users: [{ id: 11, name: "Lucía", from: "09:00", to: "20:00" }],
      services: [{ id: 501, name: "Laminado", duration: "01:00:00", userIds: [11] }],
      clients: [{ id: 900, nombre: "Marta", movil: "611 222 333" }],
    },
  });
  api = createKoiboxClient({ apiKey: "salon", fetchImpl: fake.fetch, limiter: new RateLimiter(1000) });
  apiFor = () => api;
  loadFresh = (_account, from, to) => loadKoiboxSnapshot(api, from, to);
});

afterAll(async () => {
  await wipe();
  await pgClient.end();
});

async function bookInKoibox(hhmm: string) {
  const r = await createAppointment(
    {
      locationId: ids.loc,
      serviceId: ids.laminado,
      staffId: ids.lucia,
      startsAt: at(hhmm),
      source: "web",
      consent: true,
      client: { name: "Laura Gómez", phone: "600111222", email: "laura@example.com" },
    },
    bookingOpts,
    NOW,
  );
  if (!r.ok) throw new Error(`No se pudo reservar: ${r.reason}`);
  const pushed = await pushAppointmentToKoibox(r.appointmentId, config, { apiFor, now: NOW });
  if (!pushed.ok) throw new Error(pushed.message);
  return { id: r.appointmentId, koiboxId: pushed.koiboxAppointmentId };
}

const row = async (id: number) => (await db.select().from(appointment).where(eq(appointment.id, id)))[0];
const inKoibox = (koiboxId: number) => fake.center("salon").appointments.find((a) => a.id === koiboxId)!;
const move = (id: number, hhmm: string, extra: { apiFor?: KoiboxApiFor; now?: Date } = {}) =>
  moveAppointment(id, at(hhmm), config, { now: NOW, apiFor, loadFresh, ...extra });

describe("moveAppointment con Koibox", () => {
  it("crea la nueva, guarda la hora y anula la vieja", async () => {
    const { id, koiboxId } = await bookInKoibox("10:00");
    expect(await move(id, "16:00")).toEqual({ ok: true, koibox: "synced" });

    const r = await row(id);
    expect([r.startsAt, r.endsAt, r.rescheduledAt]).toEqual([at("16:00"), at("17:00"), NOW]);
    expect(r.koiboxAppointmentId).not.toBe(koiboxId);
    expect(r.koiboxPreviousId).toBeNull();
    expect(inKoibox(koiboxId)).toMatchObject({ estado: { value: KOIBOX_STATUS.CANCELLED } });
    expect(inKoibox(koiboxId).notas).toMatch(/Cambiada de hora desde la web al 02\/11 16:00$/);
    expect(inKoibox(r.koiboxAppointmentId!)).toMatchObject({ hora_inicio: "16:00:00", estado: { value: KOIBOX_STATUS.PENDING } });
  });

  it("puede moverse a una hora que pisa la suya (10:00 → 10:30)", async () => {
    const { id, koiboxId } = await bookInKoibox("10:00");
    expect(await move(id, "10:30")).toEqual({ ok: true, koibox: "synced" });

    const r = await row(id);
    expect([r.startsAt, r.endsAt]).toEqual([at("10:30"), at("11:30")]);
    expect(r.koiboxPreviousId).toBeNull(); // la vieja ya se anuló antes de crear la nueva
    expect(inKoibox(koiboxId)).toMatchObject({ estado: { value: KOIBOX_STATUS.CANCELLED } });
    expect(inKoibox(koiboxId).notas).toMatch(/Cambiada de hora desde la web al 02\/11 10:30$/);
    expect(inKoibox(r.koiboxAppointmentId!)).toMatchObject({ hora_inicio: "10:30:00", estado: { value: KOIBOX_STATUS.PENDING } });
  });

  it("si pisa la suya y Koibox rechaza la nueva, recupera la vieja como estaba", async () => {
    const { id, koiboxId } = await bookInKoibox("10:00");
    const notesBefore = inKoibox(koiboxId).notas;
    const rejecting: KoiboxApiFor = () => ({
      ...api,
      createAppointment: async () => {
        throw new KoiboxError("bad_request", "La profesional ya tiene una cita a esa hora.");
      },
    });
    expect(await move(id, "10:30", { apiFor: rejecting })).toEqual({ ok: false, reason: "slot_taken" });

    const r = await row(id);
    expect([r.startsAt, r.koiboxAppointmentId, r.koiboxError]).toEqual([at("10:00"), koiboxId, null]);
    expect(inKoibox(koiboxId)).toMatchObject({ estado: { value: KOIBOX_STATUS.PENDING } });
    expect(inKoibox(koiboxId).notas).toBe(notesBefore);
  });

  it("si la hora nueva está ocupada en Koibox, no se toca nada", async () => {
    const { id, koiboxId } = await bookInKoibox("10:00");
    // Recepción apunta otra cita a las 12:00 directamente en Koibox
    await api.createAppointment({
      titulo: "Teléfono", fecha: MON, hora_inicio: "12:00:00", hora_fin: "13:00:00",
      user: 11, servicios: [501], estado: KOIBOX_STATUS.PENDING, cliente: 900
    });
    expect(await move(id, "12:00")).toEqual({ ok: false, reason: "slot_unavailable" });
    expect((await row(id)).startsAt).toEqual(at("10:00"));
    expect(inKoibox(koiboxId)).toMatchObject({ estado: { value: KOIBOX_STATUS.PENDING } });
  });

  it("si Koibox rechaza la nueva al crearla, la clienta conserva su cita", async () => {
    const { id, koiboxId } = await bookInKoibox("10:00");
    const rejecting: KoiboxApiFor = () => ({
      ...api,
      createAppointment: async () => {
        throw new KoiboxError("bad_request", "La profesional ya tiene una cita a esa hora.");
      },
    });
    expect(await move(id, "16:00", { apiFor: rejecting })).toEqual({ ok: false, reason: "slot_taken" });
    const r = await row(id);
    expect([r.startsAt, r.koiboxAppointmentId, r.koiboxError]).toEqual([at("10:00"), koiboxId, null]);
    expect(inKoibox(koiboxId)).toMatchObject({ estado: { value: KOIBOX_STATUS.PENDING } });
  });

  it("si no se puede anular la vieja, queda pendiente y el reintento la anula", async () => {
    const { id, koiboxId } = await bookInKoibox("10:00");
    const noUpdates: KoiboxApiFor = () => ({
      ...api,
      updateAppointment: async () => {
        throw new KoiboxError("network", "Koibox no responde");
      },
    });
    expect(await move(id, "16:00", { apiFor: noUpdates })).toEqual({ ok: true, koibox: "pending" });
    const r = await row(id);
    expect(r.startsAt).toEqual(at("16:00"));
    expect(r.koiboxPreviousId).toBe(koiboxId);
    expect(koiboxWorkFor(r, NOW)).toEqual({ kind: "cleanup", koiboxAppointmentId: koiboxId });

    const summary = await syncPendingKoibox(config, { apiFor, now: NOW });
    expect(summary).toMatchObject({ fixed: 1, failed: [] });
    expect((await row(id)).koiboxPreviousId).toBeNull();
    expect(inKoibox(koiboxId)).toMatchObject({ estado: { value: KOIBOX_STATUS.CANCELLED } });
  });

  it("borra el recordatorio de la hora vieja para que salga el de la nueva", async () => {
    const { id } = await bookInKoibox("10:00");
    await db.insert(emailLog).values({ appointmentId: id, kind: "reminder", toEmail: "laura@example.com", status: "sent" });
    await move(id, "16:00");
    const left = await db
      .select()
      .from(emailLog)
      .where(and(eq(emailLog.appointmentId, id), eq(emailLog.kind, "reminder")));
    expect(left).toEqual([]);
  });

  it("la clienta no puede dentro del plazo; tampoco si no está confirmada", async () => {
    const { id } = await bookInKoibox("10:00");
    expect(await move(id, "16:00", { now: new Date(`${MON}T08:00:00Z`) })).toEqual({ ok: false, reason: "too_late" });
    await db.update(appointment).set({ status: "cancelled" }).where(eq(appointment.id, id));
    expect(await move(id, "16:00")).toEqual({ ok: false, reason: "not_changeable" });
  });
});
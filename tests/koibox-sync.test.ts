import "./test-env"; // tiene que ser el primer import
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, pgClient } from "../db";
import {
  appointment, client, koiboxServiceMap, location, locationService, schedule,
  service, staff, staffService, timeOff,
} from "../db/schema";
import { createAppointment, type BookingOptions } from "../lib/booking";
import { createKoiboxClient, type KoiboxApi } from "../lib/koibox/client";
import { createFakeKoibox, type FakeKoibox } from "../lib/koibox/fake";
import { RateLimiter } from "../lib/koibox/limits";
import { KOIBOX_STATUS, WEB_TAG } from "../lib/koibox/statuses";
import {
  applyKoiboxChange,
  findPendingKoiboxWork,
  pushAppointmentToKoibox,
  pushNewWebBooking,
  syncKoiboxChange,
  syncPendingKoibox,
  writesToKoibox,
  type KoiboxApiFor,
} from "../lib/koibox-sync";
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

let ids: { loc: number; laminado: number; lifting: number; lucia: number; nerea: number };
let fake: FakeKoibox;
let api: KoiboxApi;
let apiFor: KoiboxApiFor;

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
  const [loc] = await db.insert(location).values({ name: "Sync test", slug: "sync-test" }).returning();
  const [laminado, lifting] = await db
    .insert(service)
    .values([
      { name: "Laminado de cejas", durationMin: 60, priceCents: 4500 },
      { name: "Lifting de pestañas", durationMin: 60, priceCents: 5500, depositCents: 1500 },
    ])
    .returning();
  const [lucia, nerea] = await db
    .insert(staff)
    .values([{ name: "Lucía", koiboxAccount: "salon", koiboxUserId: 11 }, { name: "Nerea" }])
    .returning();
  await db.insert(locationService).values([laminado, lifting].map((s) => ({ locationId: loc.id, serviceId: s.id })));
  await db.insert(staffService).values(
    [lucia, nerea].flatMap((m) => [laminado, lifting].map((s) => ({ staffId: m.id, serviceId: s.id }))),
  );
  await db.insert(koiboxServiceMap).values([
    { serviceId: laminado.id, account: "salon", koiboxServiceId: 501 },
    { serviceId: lifting.id, account: "salon", koiboxServiceId: 502 },
  ]);
  ids = { loc: loc.id, laminado: laminado.id, lifting: lifting.id, lucia: lucia.id, nerea: nerea.id };
}, 30_000);

beforeEach(async () => {
  await db.delete(appointment);
  await db.delete(client);
  fake = createFakeKoibox({
    salon: {
      users: [{ id: 11, name: "Lucía", from: "09:00", to: "20:00" }],
      services: [
        { id: 501, name: "Laminado", duration: "01:00:00", userIds: [11] },
        { id: 502, name: "Lifting", duration: "01:00:00", userIds: [11] },
      ],
      // Clienta que ya existe en Koibox, con el móvil escrito con espacios por recepción
      clients: [{ id: 900, nombre: "Marta", movil: "611 222 333", email: "marta@example.com" }],
    },
  });
  api = createKoiboxClient({ apiKey: "salon", fetchImpl: fake.fetch, limiter: new RateLimiter(1000) });
  apiFor = () => api;
});

afterAll(async () => {
  await wipe();
  await pgClient.end();
});

async function book(
  hhmm: string,
  who: { name: string; phone: string; email?: string } = { name: "Laura Gómez", phone: "600111222", email: "laura@example.com" },
  extra: { serviceId?: number; staffId?: number; source?: "web" | "phone" } = {},
) {
  const r = await createAppointment(
    {
      locationId: ids.loc,
      serviceId: extra.serviceId ?? ids.laminado,
      staffId: extra.staffId ?? ids.lucia,
      startsAt: at(hhmm),
      source: extra.source ?? "web",
      consent: true,
      client: who,
    },
    bookingOpts,
    NOW,
  );
  if (!r.ok) throw new Error(`No se pudo reservar: ${r.reason}`);
  return r.appointmentId;
}

const row = async (id: number) => (await db.select().from(appointment).where(eq(appointment.id, id)))[0];
const inKoibox = () => fake.center("salon").appointments;

describe("writesToKoibox", () => {
  it("solo cuando Koibox manda en la agenda", () => {
    expect(writesToKoibox(config)).toBe(true);
    expect(writesToKoibox({ booking: { ...config.booking, availability: "local" } })).toBe(false);
  });
});

describe("pushAppointmentToKoibox", () => {
  it("crea la clienta y la cita pendiente, y guarda el id de Koibox", async () => {
    const id = await book("10:00");
    const r = await pushAppointmentToKoibox(id, config, { apiFor, now: NOW });
    expect(r).toMatchObject({ ok: true, account: "salon", reused: false });

    const [created] = inKoibox();
    expect(created).toMatchObject({
      titulo: "Laminado de cejas",
      fecha: MON,
      hora_inicio: "10:00:00",
      hora_fin: "11:00:00",
      estado: { value: KOIBOX_STATUS.PENDING },
      notas: `Reserva web #${id}\nClienta: Laura Gómez\nCorreo: laura@example.com`,
      tags: [],
    });
    const newClient = fake.center("salon").clients.find((c) => c.movil === "600111222");
    expect(newClient).toMatchObject({ nombre: "Laura", apellido1: "Gómez", prefijo_tel: "34" });

    expect(await row(id)).toMatchObject({
      koiboxAccount: "salon",
      koiboxAppointmentId: created.id,
      koiboxSyncedAt: NOW,
      koiboxError: null,
    });
  });

  it("si ya está apuntada no crea otra", async () => {
    const id = await book("10:00");
    await pushAppointmentToKoibox(id, config, { apiFor, now: NOW });
    expect(await pushAppointmentToKoibox(id, config, { apiFor, now: NOW })).toMatchObject({ ok: true, reused: true });
    expect(inKoibox()).toHaveLength(1);
  });

  it("usa la ficha que ya existe en Koibox para ese móvil", async () => {
    const id = await book("10:00", { name: "Marta Ruiz", phone: "+34611222333" });
    await pushAppointmentToKoibox(id, config, { apiFor, now: NOW });
    expect(inKoibox()[0].cliente).toMatchObject({ value: 900 });
    expect(fake.center("salon").clients).toHaveLength(1);
  });

  it("con depósito: etiqueta de pago pendiente y el plazo en las notas", async () => {
    const id = await book("10:00", undefined, { serviceId: ids.lifting });
    expect((await row(id)).status).toBe("pending_deposit");
    await pushAppointmentToKoibox(id, config, { apiFor, now: NOW });

    const [created] = inKoibox();
    expect(created.tags?.map((t) => t.name)).toEqual([WEB_TAG.PAYMENT_PENDING]);
    // Plazo: 24 h desde la reserva (29/10 10:00 en Canarias)
    expect(created.notas).toMatch(/\nDepósito 15,00 € pendiente de pago hasta el 30\/10 10:00$/);
  });

  it("profesional sin enlazar: no llama a Koibox y guarda el motivo", async () => {
    const id = await book("10:00", undefined, { staffId: ids.nerea });
    const r = await pushAppointmentToKoibox(id, config, { apiFor, now: NOW });
    expect(r).toMatchObject({ ok: false, outcome: "rejected" });
    expect(fake.calls).toHaveLength(0);
    expect((await row(id)).koiboxError).toMatch(/Nerea no tiene cuenta de Koibox/);
    expect(r).toMatchObject({ ok: false, outcome: "rejected", taken: false });
  });

  it("si Koibox rechaza la cita (hueco ocupado allí), es un no claro", async () => {
    // Recepción dio esa hora por teléfono justo antes
    await api.createAppointment({
      titulo: "Teléfono", fecha: MON, hora_inicio: "10:00:00", hora_fin: "11:00:00",
      user: 11, cliente: 900, servicios: [501], estado: KOIBOX_STATUS.PENDING,
    });
    const id = await book("10:00");
    const r = await pushAppointmentToKoibox(id, config, { apiFor, now: NOW });
    expect(r).toMatchObject({ ok: false, outcome: "rejected" });
    const saved = await row(id);
    expect(saved.koiboxAppointmentId).toBeNull();
    expect(saved.koiboxError).toMatch(/Koibox respondió 400/);
    expect(r).toMatchObject({ ok: false, outcome: "rejected", taken: true });
  });

  it("si se corta al crear la cita, no se sabe si llegó; el reintento la encuentra y no la duplica", async () => {
    // La petición llega a Koibox (que crea la cita) pero la respuesta se pierde
    let cut = true;
    const flaky: typeof fetch = async (input, init) => {
      const res = await fake.fetch(input, init);
      if (cut && init?.method === "POST" && String(input).includes("/agenda/")) {
        cut = false;
        throw new TypeError("fetch failed");
      }
      return res;
    };
    const flakyApi = createKoiboxClient({ apiKey: "salon", fetchImpl: flaky, limiter: new RateLimiter(1000) });

    const id = await book("10:00");
    const first = await pushAppointmentToKoibox(id, config, { apiFor: () => flakyApi, now: NOW });
    expect(first).toMatchObject({ ok: false, outcome: "unknown" });
    expect(inKoibox()).toHaveLength(1); // sí llegó

    const retry = await pushAppointmentToKoibox(id, config, { apiFor, now: NOW, lookFirst: true });
    expect(retry).toMatchObject({ ok: true, reused: true, koiboxAppointmentId: inKoibox()[0].id });
    expect(inKoibox()).toHaveLength(1);
    expect((await row(id)).koiboxError).toBeNull();
  });

  it("un 500 al crear también cuenta como 'no se sabe'", async () => {
    const id = await book("10:00");
    // Solo falla la llamada que crea la cita (buscar y crear la clienta van bien)
    const failOnCreate: typeof fetch = async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/agenda/")) fake.failNext(500);
      return fake.fetch(input, init);
    };
    const r = await pushAppointmentToKoibox(id, config, {
      apiFor: () => createKoiboxClient({ apiKey: "salon", fetchImpl: failOnCreate, limiter: new RateLimiter(1000) }),
      now: NOW,
    });
    expect(r).toMatchObject({ ok: false, outcome: "unknown" });
  });

  it("si se crea en Koibox pero no se puede guardar el enlace, no lanza: queda como 'no se sabe'", async () => {
    const other = await book("12:00");
    const id = await book("10:00");
    // La cita que creará el fake tendrá el id 902 (900 es Marta, 901 será la ficha de Laura).
    // Otra cita nuestra ya lo tiene guardado: el índice único impide guardarlo dos veces.
    await db
      .update(appointment)
      .set({ koiboxAccount: "salon", koiboxAppointmentId: 902 })
      .where(eq(appointment.id, other));

    const r = await pushAppointmentToKoibox(id, config, { apiFor, now: NOW });
    expect(r).toMatchObject({ ok: false, outcome: "unknown" });
    expect(inKoibox().map((a) => a.id)).toEqual([902]);
    const saved = await row(id);
    expect(saved.koiboxAppointmentId).toBeNull();
    expect(saved.koiboxError).toMatch(/^Creada en Koibox \(id 902\) pero no se pudo guardar el enlace/);
  });

  it("una cita cancelada no se apunta", async () => {
    const id = await book("10:00");
    await db.update(appointment).set({ status: "cancelled", cancelledAt: NOW }).where(eq(appointment.id, id));
    expect(await pushAppointmentToKoibox(id, config, { apiFor, now: NOW })).toMatchObject({ ok: false, outcome: "rejected" });
    expect(inKoibox()).toHaveLength(0);
  });
});

describe("applyKoiboxChange", () => {
  it("depósito pagado: cambia la etiqueta", async () => {
    const id = await book("10:00", undefined, { serviceId: ids.lifting });
    await pushAppointmentToKoibox(id, config, { apiFor, now: NOW });
    expect(await applyKoiboxChange(id, { kind: "deposit_paid" }, config, { apiFor, now: NOW })).toEqual({
      ok: true,
      applied: true,
    });
    expect(inKoibox()[0].tags?.map((t) => t.name)).toEqual([WEB_TAG.DEPOSIT_PAID]);
  });

  it("cancelada por la clienta: 'anulada por el usuario'; repetirlo no hace nada", async () => {
    const id = await book("10:00");
    await pushAppointmentToKoibox(id, config, { apiFor, now: NOW });
    await applyKoiboxChange(id, { kind: "cancelled_by_client" }, config, { apiFor, now: NOW });
    expect(inKoibox()[0].estado).toMatchObject({ value: KOIBOX_STATUS.CANCELLED_BY_CLIENT });
    expect(await applyKoiboxChange(id, { kind: "cancelled_by_client" }, config, { apiFor, now: NOW })).toEqual({
      ok: true,
      applied: false,
    });
  });

  it("una cita que nunca llegó a Koibox no necesita nada allí", async () => {
    const id = await book("10:00");
    expect(await applyKoiboxChange(id, { kind: "deposit_expired" }, config, { apiFor, now: NOW })).toEqual({
      ok: true,
      applied: false,
    });
    expect(fake.calls).toHaveLength(0);
  });

  it("si Koibox falla, lo guarda en la cita para reintentarlo", async () => {
    const id = await book("10:00");
    await pushAppointmentToKoibox(id, config, { apiFor, now: NOW });
    fake.failNext(403);
    const r = await applyKoiboxChange(id, { kind: "cancelled_by_staff" }, config, { apiFor, now: NOW });
    expect(r.ok).toBe(false);
    expect((await row(id)).koiboxError).toMatch(/^cancelled_by_staff: Koibox respondió 403/);
  });
});

describe("pushNewWebBooking", () => {
  const phoneBooking = () =>
    api.createAppointment({
      titulo: "Teléfono", fecha: MON, hora_inicio: "10:00:00", hora_fin: "11:00:00",
      user: 11, cliente: 900, servicios: [501], estado: KOIBOX_STATUS.PENDING,
    });

  it("si Koibox la acepta, la reserva vale", async () => {
    const id = await book("10:00");
    expect(await pushNewWebBooking(id, config, { apiFor, now: NOW })).toEqual({ ok: true, synced: true });
    expect((await row(id)).status).toBe("booked");
  });

  it("si la hora se acaba de ocupar en Koibox, anula la nuestra y libera el hueco", async () => {
    await phoneBooking();
    const id = await book("10:00");
    expect(await pushNewWebBooking(id, config, { apiFor, now: NOW })).toEqual({ ok: false, reason: "slot_taken" });
    expect(await row(id)).toMatchObject({
      status: "cancelled",
      cancelledAt: NOW,
      cancelReason: "No se pudo apuntar en Koibox",
    });
    // El hueco queda libre en nuestra base: se puede volver a reservar
    await expect(book("10:00")).resolves.toBeGreaterThan(id);
  });

  it("si falla por otra cosa (p. ej. sin enlazar), también se anula, con error de servidor", async () => {
    const id = await book("10:00", undefined, { staffId: ids.nerea });
    expect(await pushNewWebBooking(id, config, { apiFor, now: NOW })).toEqual({ ok: false, reason: "server" });
    expect((await row(id)).status).toBe("cancelled");
  });

  it("si no se sabe si llegó, la reserva vale y queda marcada para el reintento", async () => {
    const id = await book("10:00");
    const down: typeof fetch = async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/agenda/")) throw new TypeError("fetch failed");
      return fake.fetch(input, init);
    };
    const r = await pushNewWebBooking(id, config, {
      apiFor: () => createKoiboxClient({ apiKey: "salon", fetchImpl: down, limiter: new RateLimiter(1000) }),
      now: NOW,
    });
    expect(r).toEqual({ ok: true, synced: false });
    const saved = await row(id);
    expect(saved.status).toBe("booked");
    expect(saved.koiboxAppointmentId).toBeNull();
    expect(saved.koiboxError).toMatch(/Koibox no responde/);
  });
});

describe("syncKoiboxChange", () => {
  it("lleva el cambio a Koibox cuando Koibox manda en la agenda", async () => {
    const id = await book("10:00");
    await pushAppointmentToKoibox(id, config, { apiFor, now: NOW });
    await syncKoiboxChange(id, { kind: "cancelled_by_staff", reason: "Enferma" }, config, { apiFor, now: NOW });
    expect(inKoibox()[0].estado).toMatchObject({ value: KOIBOX_STATUS.CANCELLED });
  });

  it("con la agenda en local no toca Koibox", async () => {
    const id = await book("10:00");
    await pushAppointmentToKoibox(id, config, { apiFor, now: NOW });
    const local = { ...config, booking: { ...config.booking, availability: "local" as const } };
    const before = fake.calls.length;
    await syncKoiboxChange(id, { kind: "cancelled_by_staff" }, local, { apiFor, now: NOW });
    expect(fake.calls).toHaveLength(before);
  });

  it("si Koibox falla no lanza: lo deja apuntado en la cita", async () => {
    const id = await book("10:00");
    await pushAppointmentToKoibox(id, config, { apiFor, now: NOW });
    fake.failNext(403);
    await expect(syncKoiboxChange(id, { kind: "deposit_paid" }, config, { apiFor, now: NOW })).resolves.toBeUndefined();
    expect((await row(id)).koiboxError).toMatch(/^deposit_paid:/);
  });
});

describe("syncPendingKoibox", () => {
  const later = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000);

  it("vence el depósito que tocaba y anula la cita en Koibox; la segunda pasada no hace nada", async () => {
    const id = await book("10:00", undefined, { serviceId: ids.lifting }); // plazo: 24 h
    await pushAppointmentToKoibox(id, config, { apiFor, now: NOW });

    // Antes del plazo no hay nada que hacer
    expect(await syncPendingKoibox(config, { apiFor, now: later(23) })).toEqual({
      expired: 0, checked: 0, fixed: 0, failed: [],
    });

    const s = await syncPendingKoibox(config, { apiFor, now: later(25) });
    expect(s).toEqual({ expired: 1, checked: 1, fixed: 1, failed: [] });
    expect((await row(id)).status).toBe("expired");
    expect(inKoibox()[0]).toMatchObject({ estado: { value: KOIBOX_STATUS.CANCELLED } });
    expect(inKoibox()[0].notas).toMatch(/Anulada: no se pagó el depósito a tiempo$/);

    expect(await syncPendingKoibox(config, { apiFor, now: later(26) })).toMatchObject({ checked: 0 });
  });

  it("también anula en Koibox los depósitos que venció otro (al reservar o en el panel)", async () => {
    const id = await book("10:00", undefined, { serviceId: ids.lifting });
    await pushAppointmentToKoibox(id, config, { apiFor, now: NOW });
    await db.update(appointment).set({ status: "expired" }).where(eq(appointment.id, id));

    expect(await findPendingKoiboxWork(later(25))).toMatchObject([
      { id, work: { kind: "change", change: { kind: "deposit_expired" } } },
    ]);
    expect(await syncPendingKoibox(config, { apiFor, now: later(25) })).toMatchObject({ expired: 0, fixed: 1 });
  });

  it("reintenta una reserva que no se sabe si llegó, sin duplicarla", async () => {
    // Llegó a Koibox pero se perdió la respuesta
    let cut = true;
    const flaky: typeof fetch = async (input, init) => {
      const res = await fake.fetch(input, init);
      if (cut && init?.method === "POST" && String(input).includes("/agenda/")) {
        cut = false;
        throw new TypeError("fetch failed");
      }
      return res;
    };
    const id = await book("10:00");
    await pushNewWebBooking(id, config, {
      apiFor: () => createKoiboxClient({ apiKey: "salon", fetchImpl: flaky, limiter: new RateLimiter(1000) }),
      now: NOW,
    });

    expect(await syncPendingKoibox(config, { apiFor, now: later(1) })).toMatchObject({ checked: 1, fixed: 1 });
    expect(inKoibox()).toHaveLength(1);
    expect(await row(id)).toMatchObject({ koiboxAppointmentId: inKoibox()[0].id, koiboxError: null });
  });

  it("reintenta una cancelación que no llegó a Koibox", async () => {
    const id = await book("10:00");
    await pushAppointmentToKoibox(id, config, { apiFor, now: NOW });
    await db
      .update(appointment)
      .set({ status: "cancelled", cancelledAt: later(1), cancelReason: "Enferma" })
      .where(eq(appointment.id, id));
    fake.failNext(403);
    await syncKoiboxChange(id, { kind: "cancelled_by_client" }, config, { apiFor, now: later(1) });
    expect(inKoibox()[0].estado).toMatchObject({ value: KOIBOX_STATUS.PENDING });

    const s = await syncPendingKoibox(config, { apiFor, now: later(2) });
    expect(s).toMatchObject({ checked: 1, fixed: 1 });
    expect(inKoibox()[0].estado).toMatchObject({ value: KOIBOX_STATUS.CANCELLED_BY_CLIENT });
  });

  it("si sigue fallando, lo cuenta y lo deja para la siguiente pasada", async () => {
    const id = await book("10:00");
    await pushAppointmentToKoibox(id, config, { apiFor, now: NOW });
    await db.update(appointment).set({ status: "cancelled", cancelledAt: later(1) }).where(eq(appointment.id, id));
    fake.failNext(403);
    const s = await syncPendingKoibox(config, { apiFor, now: later(2) });
    expect(s).toMatchObject({ checked: 1, fixed: 0 });
    expect(s.failed.map((f) => f.id)).toEqual([id]);
    expect(s.failed[0].message).toMatch(/^cancelled_by_client: Koibox respondió 403/);
    expect(await findPendingKoiboxWork(later(3))).toHaveLength(1);
  });

  it("con la agenda en local no hace nada", async () => {
    const local = { ...config, booking: { ...config.booking, availability: "local" as const } };
    expect(await syncPendingKoibox(local, { apiFor, now: NOW })).toEqual({
      disabled: true, expired: 0, checked: 0, fixed: 0, failed: [],
    });
  });
});
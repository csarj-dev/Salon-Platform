import "./test-env"; // tiene que ser el primer import
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, pgClient } from "../db";
import {
  appointment, client, emailLog, location, locationService, schedule,
  service, staff, staffService, timeOff,
} from "../db/schema";
import es from "../messages/es.json";
import { createAppointment, type BookingOptions } from "../lib/booking";
import type { EmailMessage, EmailResult } from "../lib/email/driver";
import { latestEmailByAppointment } from "../lib/email/email-status";
import { findDueReminders, sendDueReminders } from "../lib/email/reminders";
import { salonConfigSchema } from "../lib/salon-config";

const config = salonConfigSchema.parse({
  name: "Salón de prueba",
  timezone: "Atlantic/Canary",
  locales: ["es", "en"],
  defaultLocale: "es",
  contact: { email: "hola@salon.test" },
  booking: {},
});

const opts: BookingOptions = {
  zone: "Atlantic/Canary",
  stepMin: 30,
  bufferMin: 0,
  minNoticeHours: 2,
  maxDaysAhead: 60,
  depositHoldHours: 24,
};

// Momento en que "corre el planificador" en estas pruebas
const NOW = new Date("2026-11-10T12:00:00Z");
const hoursFrom = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

let loc: number;
let st: number;
let svc: number;

const messagesFor = async () => es;

function fakeSender(result: EmailResult = { ok: true, id: "prov-1" }) {
  const sent: EmailMessage[] = [];
  const send = async (message: EmailMessage) => {
    sent.push(message);
    return result;
  };
  return { sent, send };
}

// Reserva en un hueco libre de la agenda y luego coloca la cita donde interesa para la prueba
// (la hora real de la reserva no importa: aquí solo se prueba cuándo toca el recordatorio)
let slot = 0;
async function makeAppointment(
  email: string | undefined,
  patch: { startsAt: Date; createdAt: Date; status?: "booked" | "cancelled" | "pending_deposit"; depositPaidAt?: Date },
) {
  const hhmm = ["10:00", "11:00", "12:00", "13:00"][slot++ % 4];
  const r = await createAppointment(
    {
      locationId: loc,
      staffId: st,
      serviceId: svc,
      startsAt: new Date(`2026-11-02T${hhmm}:00Z`),
      source: "phone",
      consent: false,
      client: { name: `Clienta ${slot}`, phone: `60011122${slot}`, email },
    },
    opts,
    new Date("2026-10-19T10:00:00Z"),
  );
  if (!r.ok) throw new Error(`No se pudo reservar: ${r.reason}`);
  await db
    .update(appointment)
    .set({
      startsAt: patch.startsAt,
      endsAt: new Date(patch.startsAt.getTime() + 3_600_000),
      createdAt: patch.createdAt,
      status: patch.status ?? "booked",
      depositPaidAt: patch.depositPaidAt ?? null,
      // Una cita pendiente de depósito tiene que llevar importe y plazo (lo exige la base de datos)
      ...(patch.status === "pending_deposit"
        ? { depositCents: 1000, depositDueAt: hoursFrom(5) }
        : {}),
    })
    .where(eq(appointment.id, r.appointmentId));
  return r.appointmentId;
}

const run = (send: (m: EmailMessage) => Promise<EmailResult>) =>
  sendDueReminders(NOW, { send, config, loadMessagesFor: messagesFor });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.delete(appointment);
  await db.delete(timeOff);
  await db.delete(schedule);
  await db.delete(locationService);
  await db.delete(staffService);
  await db.delete(client);
  await db.delete(staff);
  await db.delete(service);
  await db.delete(location);

  const [l] = await db.insert(location).values({ name: "Local de prueba", address: "Calle Mayor 1" }).returning();
  const [a] = await db.insert(service).values({ name: "Servicio", durationMin: 60, priceCents: 3000 }).returning();
  const [s] = await db.insert(staff).values({ name: "Profesional de prueba" }).returning();
  loc = l.id;
  st = s.id;
  svc = a.id;
  await db.insert(locationService).values({ locationId: l.id, serviceId: a.id });
  await db.insert(staffService).values({ staffId: s.id, serviceId: a.id });
  await db.insert(schedule).values({
    staffId: s.id, locationId: l.id, weekday: 1, startTime: "10:00", endTime: "14:00",
  });
}, 30_000);

beforeEach(async () => {
  slot = 0;
  await db.delete(appointment); // email_log se borra en cascada
  await db.delete(client);
});

afterAll(async () => {
  await pgClient.end();
});

describe("qué citas reciben recordatorio", () => {
  it("solo la confirmada hace días, con email y que empieza dentro de 24 h", async () => {
    const due = await makeAppointment("a@example.com", { startsAt: hoursFrom(20), createdAt: hoursFrom(-72) });
    // Reservada hace 2 h: acaba de recibir la confirmación
    await makeAppointment("b@example.com", { startsAt: hoursFrom(21), createdAt: hoursFrom(-2) });
    // Todavía falta más de 24 h
    await makeAppointment("c@example.com", { startsAt: hoursFrom(30), createdAt: hoursFrom(-72) });
    // Sin email
    await makeAppointment(undefined, { startsAt: hoursFrom(22), createdAt: hoursFrom(-72) });

    const found = await findDueReminders(NOW);
    expect(found.map((r) => r.id)).toEqual([due]);
  });

  it("con depósito cuenta desde que se validó el pago, no desde que se reservó", async () => {
    // Reservada hace 3 días pero pagada hace 1 h: la confirmación es reciente
    await makeAppointment("a@example.com", {
      startsAt: hoursFrom(20), createdAt: hoursFrom(-72), depositPaidAt: hoursFrom(-1),
    });
    expect(await findDueReminders(NOW)).toHaveLength(0);
  });

  it("no avisa de citas canceladas, pendientes de depósito ni a punto de empezar", async () => {
    await makeAppointment("a@example.com", { startsAt: hoursFrom(20), createdAt: hoursFrom(-72), status: "cancelled" });
    await makeAppointment("b@example.com", { startsAt: hoursFrom(21), createdAt: hoursFrom(-72), status: "pending_deposit" });
    await makeAppointment("c@example.com", { startsAt: hoursFrom(0.5), createdAt: hoursFrom(-72) });
    expect(await findDueReminders(NOW)).toHaveLength(0);
  });
});

describe("sendDueReminders", () => {
  it("envía el recordatorio una sola vez aunque se ejecute varias", async () => {
    const id = await makeAppointment("a@example.com", { startsAt: hoursFrom(20), createdAt: hoursFrom(-72) });
    const { sent, send } = fakeSender();

    expect(await run(send)).toEqual({ checked: 1, sent: 1, failed: 0, skipped: 0 });
    expect(await run(send)).toEqual({ checked: 0, sent: 0, failed: 0, skipped: 0 });

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("a@example.com");
    expect(sent[0].subject).toBe("Recordatorio de tu cita en Salón de prueba");
    const logs = await db.select().from(emailLog).where(eq(emailLog.appointmentId, id));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ kind: "reminder", status: "sent" });
  });

  it("dos ejecuciones simultáneas no duplican el envío", async () => {
    await makeAppointment("a@example.com", { startsAt: hoursFrom(20), createdAt: hoursFrom(-72) });
    const { sent, send } = fakeSender();
    await Promise.all([run(send), run(send)]);
    expect(sent).toHaveLength(1);
  });

  it("si el envío falla, reintenta en la siguiente ejecución, hasta 3 veces", async () => {
    const id = await makeAppointment("a@example.com", { startsAt: hoursFrom(20), createdAt: hoursFrom(-72) });
    const failing = fakeSender({ ok: false, error: "caído" });

    for (let i = 0; i < 3; i++) {
      expect(await run(failing.send)).toMatchObject({ checked: 1, sent: 0, failed: 1 });
    }
    // A la cuarta ya no insiste
    expect(await run(failing.send)).toMatchObject({ checked: 0 });
    expect(failing.sent).toHaveLength(3);
    expect(await db.select().from(emailLog).where(eq(emailLog.appointmentId, id))).toHaveLength(3);
  });

  it("un fallo y luego un éxito deja el recordatorio como enviado", async () => {
    await makeAppointment("a@example.com", { startsAt: hoursFrom(20), createdAt: hoursFrom(-72) });
    await run(fakeSender({ ok: false, error: "caído" }).send);
    expect(await run(fakeSender().send)).toMatchObject({ sent: 1 });
    expect(await run(fakeSender().send)).toMatchObject({ checked: 0 });
  });
});

describe("latestEmailByAppointment", () => {
  it("devuelve el último correo de cada cita", async () => {
    const a = await makeAppointment("a@example.com", { startsAt: hoursFrom(20), createdAt: hoursFrom(-72) });
    const b = await makeAppointment("b@example.com", { startsAt: hoursFrom(40), createdAt: hoursFrom(-72) });
    await db.insert(emailLog).values([
      { appointmentId: a, kind: "confirmation", toEmail: "a@example.com", status: "sent", sentAt: hoursFrom(-71) },
      { appointmentId: a, kind: "reminder", toEmail: "a@example.com", status: "failed", error: "caído" },
    ]);

    const map = await latestEmailByAppointment([a, b]);
    expect(map.get(a)).toMatchObject({ kind: "reminder", status: "failed", error: "caído" });
    expect(map.has(b)).toBe(false);
    expect((await latestEmailByAppointment([])).size).toBe(0);
  });
});
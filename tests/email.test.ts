import "./test-env"; // tiene que ser el primer import
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, pgClient } from "../db";
import {
  appointment, client, emailLog, location, locationService, schedule,
  service, staff, staffService, timeOff,
} from "../db/schema";
import en from "../messages/en.json";
import es from "../messages/es.json";
import { createAppointment, type BookingOptions } from "../lib/booking";
import { sendAppointmentEmail } from "../lib/email/appointment-email";
import type { EmailMessage, EmailResult } from "../lib/email/driver";
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

const NOW = new Date("2026-10-19T10:00:00Z");
// Lunes 2 de noviembre de 2026: en Canarias es hora de invierno (UTC+0)
const at = (hhmm: string) => new Date(`2026-11-02T${hhmm}:00Z`);

let loc: number;
let st: number;
let plain: number; // sin depósito

const messagesFor = async (locale: string) => (locale === "en" ? en : es);

// Un "envío" falso que guarda lo que recibe
function fakeSender(result: EmailResult = { ok: true, id: "prov-1" }) {
  const sent: EmailMessage[] = [];
  const send = async (message: EmailMessage) => {
    sent.push(message);
    return result;
  };
  return { sent, send };
}

async function book(
  email: string | undefined,
  extra: Record<string, unknown> = {},
  phone = "600111222",
) {
  const r = await createAppointment(
    {
      locationId: loc,
      staffId: st,
      serviceId: plain,
      startsAt: at("10:00"),
      source: "web",
      consent: true,
      client: { name: "Ana Pérez", phone, email },
      ...extra,
    },
    opts,
    NOW,
  );
  if (!r.ok) throw new Error(`No se pudo reservar: ${r.reason}`);
  return r;
}

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

  const [l] = await db
    .insert(location)
    .values({ name: "Local de prueba", address: "Calle Mayor 1" })
    .returning();
  const [a] = await db
    .insert(service)
    .values({ name: "Sin depósito", durationMin: 60, priceCents: 3000 })
    .returning();
  const [s] = await db.insert(staff).values({ name: "Profesional de prueba" }).returning();
  loc = l.id;
  st = s.id;
  plain = a.id;
  await db.insert(locationService).values({ locationId: l.id, serviceId: a.id });
  await db.insert(staffService).values({ staffId: s.id, serviceId: a.id });
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
  await db.delete(appointment); // email_log se borra en cascada
  await db.delete(client);
});

afterAll(async () => {
  await pgClient.end();
});

describe("guardar el idioma y el email al reservar", () => {
  it("la cita guarda el idioma en que reservó", async () => {
    const r = await book("ana@example.com", { locale: "en" });
    const [row] = await db.select().from(appointment).where(eq(appointment.id, r.appointmentId));
    expect(row.locale).toBe("en");
  });

  it("sin idioma queda vacío", async () => {
    const r = await book("ana@example.com");
    const [row] = await db.select().from(appointment).where(eq(appointment.id, r.appointmentId));
    expect(row.locale).toBeNull();
  });

  it("si la clienta vuelve con otro email, se queda con el último", async () => {
    await book("viejo@example.com");
    await db.delete(appointment); // libera el hueco para reservar otra vez
    await book("nuevo@example.com");
    const rows = await db.select().from(client);
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("nuevo@example.com");
  });

  it("si vuelve sin email (reserva de recepción), no borra el que tenía", async () => {
    await book("ana@example.com");
    await db.delete(appointment);
    await book(undefined, { source: "phone" });
    const [row] = await db.select().from(client);
    expect(row.email).toBe("ana@example.com");
  });
});

describe("sendAppointmentEmail", () => {
  it("envía la confirmación al email de la clienta, en su idioma, y lo anota", async () => {
    const r = await book("ana@example.com", { locale: "en" });
    const { sent, send } = fakeSender({ ok: true, id: "prov-9" });

    const outcome = await sendAppointmentEmail(r.appointmentId, "confirmation", {
      now: NOW, send, config, loadMessagesFor: messagesFor,
    });

    expect(outcome).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("ana@example.com");
    expect(sent[0].subject).toBe("Appointment confirmed at Salón de prueba");
    expect(sent[0].replyTo).toBe("hola@salon.test");
    expect(sent[0].attachments?.[0].filename).toBe("cita.ics");

    const logs = await db.select().from(emailLog);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      appointmentId: r.appointmentId,
      kind: "confirmation",
      toEmail: "ana@example.com",
      status: "sent",
      providerId: "prov-9",
      error: null,
    });
    expect(logs[0].sentAt).not.toBeNull();
  });

  it("sin idioma guardado usa el del salón", async () => {
    const r = await book("ana@example.com");
    const { sent, send } = fakeSender();
    await sendAppointmentEmail(r.appointmentId, "confirmation", {
      now: NOW, send, config, loadMessagesFor: messagesFor,
    });
    expect(sent[0].subject).toBe("Cita confirmada en Salón de prueba");
  });

  it("sin email no envía nada ni deja rastro", async () => {
    const r = await book(undefined, { source: "phone" });
    const { sent, send } = fakeSender();
    const outcome = await sendAppointmentEmail(r.appointmentId, "confirmation", {
      send, config, loadMessagesFor: messagesFor,
    });
    expect(outcome).toEqual({ ok: false, reason: "no_email" });
    expect(sent).toHaveLength(0);
    expect(await db.select().from(emailLog)).toHaveLength(0);
  });

  it("una cita que no existe devuelve not_found", async () => {
    const { send } = fakeSender();
    expect(
      await sendAppointmentEmail(999_999, "confirmation", { send, config, loadMessagesFor: messagesFor }),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  it("si el proveedor falla, no lanza: lo anota como fallido con el motivo", async () => {
    const r = await book("ana@example.com");
    const { send } = fakeSender({ ok: false, error: "Resend 422 validation_error" });
    const outcome = await sendAppointmentEmail(r.appointmentId, "confirmation", {
      now: NOW, send, config, loadMessagesFor: messagesFor,
    });
    expect(outcome).toEqual({ ok: false, reason: "send_failed", error: "Resend 422 validation_error" });
    const [log] = await db.select().from(emailLog);
    expect(log).toMatchObject({ status: "failed", error: "Resend 422 validation_error" });
    expect(log.sentAt).toBeNull();
  });

  it("si el envío lanza una excepción, tampoco rompe nada", async () => {
    const r = await book("ana@example.com");
    const send = async (): Promise<EmailResult> => {
      throw new Error("boom");
    };
    const outcome = await sendAppointmentEmail(r.appointmentId, "confirmation", {
      now: NOW, send, config, loadMessagesFor: messagesFor,
    });
    expect(outcome).toMatchObject({ ok: false, reason: "send_failed", error: "boom" });
    const [log] = await db.select().from(emailLog);
    expect(log.status).toBe("failed");
  });

  it("la confirmación se puede reenviar: queda una fila por envío", async () => {
    const r = await book("ana@example.com");
    const { send } = fakeSender();
    const o = { now: NOW, send, config, loadMessagesFor: messagesFor };
    await sendAppointmentEmail(r.appointmentId, "confirmation", o);
    await sendAppointmentEmail(r.appointmentId, "confirmation", o);
    expect(await db.select().from(emailLog)).toHaveLength(2);
  });

  it("el correo de cancelación no lleva adjunto", async () => {
    const r = await book("ana@example.com");
    const { sent, send } = fakeSender();
    await sendAppointmentEmail(r.appointmentId, "cancellation", {
      now: NOW, send, config, loadMessagesFor: messagesFor,
    });
    expect(sent[0].subject).toBe("Tu cita en Salón de prueba ha sido cancelada");
    expect(sent[0].attachments).toBeUndefined();
  });
});

describe("recordatorio: una sola vez por cita", () => {
  it("el segundo intento se rechaza como already_sent", async () => {
    const r = await book("ana@example.com");
    const { sent, send } = fakeSender();
    const o = { now: NOW, send, config, loadMessagesFor: messagesFor };
    expect(await sendAppointmentEmail(r.appointmentId, "reminder", o)).toEqual({ ok: true });
    expect(await sendAppointmentEmail(r.appointmentId, "reminder", o)).toEqual({
      ok: false,
      reason: "already_sent",
    });
    expect(sent).toHaveLength(1);
  });

  it("si el primero falló, se puede reintentar", async () => {
    const r = await book("ana@example.com");
    const base = { now: NOW, config, loadMessagesFor: messagesFor };
    const failing = fakeSender({ ok: false, error: "caído" });
    expect(await sendAppointmentEmail(r.appointmentId, "reminder", { ...base, send: failing.send }))
      .toMatchObject({ ok: false, reason: "send_failed" });

    const working = fakeSender();
    expect(await sendAppointmentEmail(r.appointmentId, "reminder", { ...base, send: working.send }))
      .toEqual({ ok: true });

    const statuses = (await db.select().from(emailLog)).map((l) => l.status).sort();
    expect(statuses).toEqual(["failed", "sent"]);
  });
});
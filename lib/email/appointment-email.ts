import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import {
  appointment,
  client,
  emailLog,
  location,
  service,
  serviceTranslation,
  staff,
} from "../../db/schema";
import { pickTranslation } from "../pick-translation";
import { loadSalonConfig, type SalonConfig } from "../salon-config";
import {
  buildAppointmentEmail,
  pickEmailLocale,
  type EmailData,
  type EmailKind,
  type Messages,
} from "./build";
import { sendEmail } from "./driver";

async function loadMessages(locale: string): Promise<Messages> {
  return (await import(`../../messages/${locale}.json`)).default as Messages;
}

// ───────── Datos de la cita ─────────

export async function loadEmailData(
  appointmentId: number,
  config: Pick<SalonConfig, "locales" | "defaultLocale">,
): Promise<EmailData | null> {
  const [row] = await db
    .select({
      id: appointment.id,
      publicToken: appointment.publicToken,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      locale: appointment.locale,
      priceCents: appointment.priceAppliedCents,
      depositCents: appointment.depositCents,
      serviceId: appointment.serviceId,
      serviceName: service.name,
      clientName: client.name,
      clientEmail: client.email,
      locationName: location.name,
      locationAddress: location.address,
      mapsUrl: location.mapsUrl,
      staffName: staff.name,
    })
    .from(appointment)
    .innerJoin(client, eq(client.id, appointment.clientId))
    .innerJoin(service, eq(service.id, appointment.serviceId))
    .innerJoin(location, eq(location.id, appointment.locationId))
    .innerJoin(staff, eq(staff.id, appointment.staffId))
    .where(eq(appointment.id, appointmentId));
  if (!row) return null;

  const locale = pickEmailLocale(row.locale, config);
  const translations = await db
    .select()
    .from(serviceTranslation)
    .where(
      and(
        eq(serviceTranslation.serviceId, row.serviceId),
        inArray(serviceTranslation.locale, [...new Set([locale, config.defaultLocale])]),
      ),
    );

  return {
    appointmentId: row.id,
    publicToken: row.publicToken,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    locale,
    clientName: row.clientName,
    clientEmail: row.clientEmail,
    serviceName: pickTranslation(translations, locale, config.defaultLocale, row.serviceName).name,
    locationName: row.locationName,
    locationAddress: row.locationAddress,
    mapsUrl: row.mapsUrl,
    staffName: row.staffName,
    priceCents: row.priceCents,
    depositCents: row.depositCents,
  };
}

// ───────── Envío y registro ─────────

export type SendOutcome =
  | { ok: true }
  | { ok: false; reason: "not_found" | "no_email" | "already_sent" | "send_failed"; error?: string };

type SendOptions = {
  now?: Date;
  // Para las pruebas: sustituyen al envío real y a la lectura de la configuración
  send?: typeof sendEmail;
  config?: SalonConfig;
  loadMessagesFor?: (locale: string) => Promise<Messages>;
};

// Envía un correo de la cita y deja constancia en email_log. Nunca lanza: un fallo de
// correo no debe romper la reserva, la validación ni la cancelación que lo originó.
export async function sendAppointmentEmail(
  appointmentId: number,
  kind: EmailKind,
  opts: SendOptions = {},
): Promise<SendOutcome> {
  const now = opts.now ?? new Date();
  const send = opts.send ?? sendEmail;
  let logId: number | null = null;

  try {
    const config = opts.config ?? (await loadSalonConfig());
    const data = await loadEmailData(appointmentId, config);
    if (!data) return { ok: false, reason: "not_found" };
    if (!data.clientEmail) return { ok: false, reason: "no_email" };

    // Se anota antes de enviar. Para el recordatorio, esta fila es la reserva que impide
    // que dos ejecuciones simultáneas lo manden dos veces.
    const [log] = await db
      .insert(emailLog)
      .values({ appointmentId, kind, toEmail: data.clientEmail })
      .onConflictDoNothing()
      .returning({ id: emailLog.id });
    if (!log) return { ok: false, reason: "already_sent" };
    logId = log.id;

    const messages = await (opts.loadMessagesFor ?? loadMessages)(data.locale);
    const content = buildAppointmentEmail(kind, data, config, messages, now);
    const result = await send({
      ...content,
      to: data.clientEmail,
      replyTo: process.env.EMAIL_REPLY_TO || config.contact.email,
      idempotencyKey: `${kind}/${appointmentId}/${log.id}`,
    });

    if (!result.ok) {
      await markFailed(log.id, result.error);
      return { ok: false, reason: "send_failed", error: result.error };
    }
    await db
      .update(emailLog)
      .set({ status: "sent", providerId: result.id, sentAt: new Date() })
      .where(eq(emailLog.id, log.id));
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[email] ${kind} de la cita ${appointmentId}:`, error);
    if (logId !== null) await markFailed(logId, message).catch(() => undefined);
    return { ok: false, reason: "send_failed", error: message };
  }
}

async function markFailed(logId: number, error: string) {
  await db
    .update(emailLog)
    .set({ status: "failed", error: error.slice(0, 500) })
    .where(eq(emailLog.id, logId));
}
// Escribe en Koibox las citas de la web y sus cambios, y guarda en nuestra cita el resultado
// (koibox_account, koibox_appointment_id, koibox_synced_at y, si falla, koibox_error).
// Solo se usa con booking.availability = "koibox": entonces Koibox es quien manda en la agenda.
import { eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "../db";
import { appointment, client, koiboxServiceMap, service, staff } from "../db/schema";
import { findWebAppointment, koiboxPatchFor, toKoiboxAppointment, type WebChange } from "./koibox/booking";
import { findOrCreateClient, type KoiboxApi } from "./koibox/client";
import { getKoiboxClient } from "./koibox/driver";
import { KoiboxError } from "./koibox/limits";
import { resolveKoiboxTarget } from "./koibox/routing";
import type { SalonConfig } from "./salon-config";

// ¿Las citas de la web se apuntan en Koibox? Va unido a sacar los huecos de Koibox:
// si Koibox manda en la agenda, manda para leer y para escribir.
export function writesToKoibox(config: Pick<SalonConfig, "booking">): boolean {
  return config.booking.availability === "koibox";
}

// Cliente de Koibox de cada cuenta. En los tests se pasa uno con el Koibox de mentira.
export type KoiboxApiFor = (account: string) => KoiboxApi;

export function koiboxApiFor(config: Pick<SalonConfig, "koibox">): KoiboxApiFor {
  return (account) => getKoiboxClient(account, config.koibox);
}

export type PushResult =
  | { ok: true; account: string; koiboxAppointmentId: number; reused: boolean }
  // "rejected": Koibox dijo que no (o faltan enlaces): seguro que allí no se creó nada.
  // "unknown": se cortó al crear la cita: puede que sí se creara. No se repite a ciegas.
  | { ok: false; outcome: "rejected" | "unknown"; message: string };

const MAX_ERROR = 500; // lo que admite la columna koibox_error

const errorText = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR);

// Un fallo al crear la cita del que no sabemos si llegó a Koibox
function mayHaveArrived(error: unknown): boolean {
  if (!(error instanceof KoiboxError)) return true; // fallo raro: mejor no dar nada por hecho
  return error.code === "network" || error.code === "server_error" || error.code === "invalid_response";
}

async function saveError(appointmentId: number, message: string) {
  await db
    .update(appointment)
    .set({ koiboxError: message.slice(0, MAX_ERROR) })
    .where(eq(appointment.id, appointmentId));
}

// Apunta en Koibox una cita de nuestra base: busca o crea a la clienta por móvil y crea la cita
// como Pendiente, con notas y etiqueta de pago si lleva depósito.
// `lookFirst`: antes de crear, mira si ya está en Koibox (para los reintentos, por si la primera
// vez sí llegó y lo que se perdió fue la respuesta).
export async function pushAppointmentToKoibox(
  appointmentId: number,
  config: SalonConfig,
  opts: { apiFor?: KoiboxApiFor; now?: Date; lookFirst?: boolean } = {},
): Promise<PushResult> {
  const apiFor = opts.apiFor ?? koiboxApiFor(config);
  const now = opts.now ?? new Date();

  const [row] = await db
    .select({
      id: appointment.id,
      status: appointment.status,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      clientName: appointment.clientName,
      clientEmail: appointment.clientEmail,
      depositCents: appointment.depositCents,
      depositDueAt: appointment.depositDueAt,
      koiboxAccount: appointment.koiboxAccount,
      koiboxAppointmentId: appointment.koiboxAppointmentId,
      serviceId: appointment.serviceId,
      serviceName: service.name,
      phone: client.phone,
      staffId: staff.id,
      staffName: staff.name,
      staffAccount: staff.koiboxAccount,
      staffUserId: staff.koiboxUserId,
    })
    .from(appointment)
    .innerJoin(service, eq(service.id, appointment.serviceId))
    .innerJoin(staff, eq(staff.id, appointment.staffId))
    .innerJoin(client, eq(client.id, appointment.clientId))
    .where(eq(appointment.id, appointmentId));
  if (!row) return { ok: false, outcome: "rejected", message: `No existe la cita ${appointmentId}` };

  // Ya está apuntada: no se crea otra
  if (row.koiboxAccount && row.koiboxAppointmentId !== null) {
    return { ok: true, account: row.koiboxAccount, koiboxAppointmentId: row.koiboxAppointmentId, reused: true };
  }
  if (row.status !== "booked" && row.status !== "pending_deposit") {
    return { ok: false, outcome: "rejected", message: `La cita ${appointmentId} está ${row.status}: no se apunta en Koibox` };
  }

  const links = await db.select().from(koiboxServiceMap).where(eq(koiboxServiceMap.serviceId, row.serviceId));
  const routed = resolveKoiboxTarget(
    { staffId: row.staffId, staffName: row.staffName, koiboxAccount: row.staffAccount, koiboxUserId: row.staffUserId },
    row.serviceId,
    links,
    Object.keys(config.koibox.accounts),
  );
  if (!routed.ok) {
    await saveError(appointmentId, routed.message);
    return { ok: false, outcome: "rejected", message: routed.message };
  }
  const { account, koiboxUserId, koiboxServiceId } = routed.target;

  const linked = async (koiboxAppointmentId: number, reused: boolean): Promise<PushResult> => {
    await db
      .update(appointment)
      .set({ koiboxAccount: account, koiboxAppointmentId, koiboxSyncedAt: now, koiboxError: null })
      .where(eq(appointment.id, appointmentId));
    return { ok: true, account, koiboxAppointmentId, reused };
  };

  let api: KoiboxApi;
  let koiboxClientId: number;
  try {
    api = apiFor(account);
    if (opts.lookFirst) {
      const day = DateTime.fromJSDate(row.startsAt, { zone: config.timezone }).toFormat("yyyy-MM-dd");
      const existing = findWebAppointment(
        await api.listAppointments({ from: day, to: day, userIds: [koiboxUserId] }),
        appointmentId,
      );
      if (existing) return linked(existing.id, true);
    }
    const found = await findOrCreateClient(
      api,
      { name: row.clientName, phone: row.phone, email: row.clientEmail },
      config.phoneCountryCode,
    );
    koiboxClientId = found.client.id;
  } catch (error) {
    // Hasta aquí no se ha creado ninguna cita: como mucho la ficha de la clienta, que no molesta
    const message = errorText(error);
    await saveError(appointmentId, message);
    return { ok: false, outcome: "rejected", message };
  }

  try {
    const created = await api.createAppointment(
      toKoiboxAppointment({
        ref: row.id,
        serviceName: row.serviceName,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        zone: config.timezone,
        koiboxUserId,
        koiboxClientId,
        koiboxServiceId,
        clientName: row.clientName,
        clientEmail: row.clientEmail,
        deposit:
          row.status === "pending_deposit" && row.depositCents !== null && row.depositDueAt !== null
            ? { cents: row.depositCents, currency: config.currency, dueAt: row.depositDueAt }
            : null,
      }),
    );
    return linked(created.id, false);
  } catch (error) {
    const message = errorText(error);
    await saveError(appointmentId, message);
    return { ok: false, outcome: mayHaveArrived(error) ? "unknown" : "rejected", message };
  }
}

export type ChangeSyncResult =
  | { ok: true; applied: boolean } // applied: false = no había nada que cambiar
  | { ok: false; message: string };

// Lleva a Koibox un cambio de la cita (depósito pagado o vencido, cancelación, cambio de hora).
// Si la cita nunca llegó a Koibox, no hay nada que hacer allí.
export async function applyKoiboxChange(
  appointmentId: number,
  change: WebChange,
  config: SalonConfig,
  opts: { apiFor?: KoiboxApiFor; now?: Date } = {},
): Promise<ChangeSyncResult> {
  const apiFor = opts.apiFor ?? koiboxApiFor(config);
  const now = opts.now ?? new Date();

  const [row] = await db
    .select({ account: appointment.koiboxAccount, koiboxId: appointment.koiboxAppointmentId })
    .from(appointment)
    .where(eq(appointment.id, appointmentId));
  if (!row?.account || row.koiboxId === null) return { ok: true, applied: false };

  try {
    const api = apiFor(row.account);
    const current = await api.getAppointment(row.koiboxId);
    // La borraron en Koibox: allí ya no ocupa nada
    const patch = current ? koiboxPatchFor(change, current) : null;
    if (patch) await api.updateAppointment(row.koiboxId, patch);
    await db
      .update(appointment)
      .set({ koiboxSyncedAt: now, koiboxError: null })
      .where(eq(appointment.id, appointmentId));
    return { ok: true, applied: patch !== null };
  } catch (error) {
    const message = `${change.kind}: ${errorText(error)}`;
    await saveError(appointmentId, message);
    return { ok: false, message };
  }
}

// Cambio de hora: el PATCH de Koibox no mueve citas, así que se anula la de antes y se crea
// otra con la hora nueva (que ya está guardada en nuestra cita).
export async function moveAppointmentInKoibox(
  appointmentId: number,
  config: SalonConfig,
  opts: { apiFor?: KoiboxApiFor; now?: Date } = {},
): Promise<PushResult> {
  const [row] = await db
    .select({ startsAt: appointment.startsAt })
    .from(appointment)
    .where(eq(appointment.id, appointmentId));
  if (!row) return { ok: false, outcome: "rejected", message: `No existe la cita ${appointmentId}` };

  const cancelled = await applyKoiboxChange(
    appointmentId,
    { kind: "moved", startsAt: row.startsAt, zone: config.timezone },
    config,
    opts,
  );
  // Si no se pudo anular la de antes, no se crea la nueva (quedarían las dos ocupando)
  if (!cancelled.ok) return { ok: false, outcome: "rejected", message: cancelled.message };

  await db.update(appointment).set({ koiboxAppointmentId: null }).where(eq(appointment.id, appointmentId));
  return pushAppointmentToKoibox(appointmentId, config, opts);
}
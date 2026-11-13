// Escribe en Koibox las citas de la web y sus cambios, y guarda en nuestra cita el resultado
// (koibox_account, koibox_appointment_id, koibox_synced_at y, si falla, koibox_error).
// Solo se usa con booking.availability = "koibox": entonces Koibox es quien manda en la agenda.
import { and, asc, eq, gt, inArray, isNotNull, or } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "../db";
import { appointment, client, koiboxServiceMap, service, staff } from "../db/schema";
import { expireOverdueDeposits } from "./deposit-db";
import { findWebAppointment, koiboxPatchFor, toKoiboxAppointment, type WebChange } from "./koibox/booking";
import { koiboxCardState } from "./koibox/card-state";
import { findOrCreateClient, type KoiboxApi } from "./koibox/client";
import type { KoiboxAppointment } from "./koibox/types";
import { getKoiboxClient } from "./koibox/driver";
import { KoiboxError, RateLimiter } from "./koibox/limits";
import { hasSeveralCollectors, resolveCollector } from "./collectors";
import { koiboxWorkFor } from "./koibox/pending";
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

// Para las páginas y acciones del panel: una cola propia (no esperan detrás de la
// sincronización) y un tiempo máximo, para no dejar la página esperando si Koibox no
// responde. Koibox limita a 60 peticiones/minuto POR IP: una sola cola para todas las
// cuentas, con margen para que quepa la sincronización a la vez.
export function koiboxPanelApiFor(
  config: Pick<SalonConfig, "koibox">,
  opts: { limit?: number; timeoutMs?: number; maxRetries?: number } = {},
): KoiboxApiFor {
  const limiter = new RateLimiter(opts.limit ?? 15);
  const clients = new Map<string, KoiboxApi>();
  return (account) => {
    let api = clients.get(account);
    if (!api) {
      api = getKoiboxClient(account, config.koibox, process.env, {
        limiter,
        timeoutMs: opts.timeoutMs ?? 8_000,
        maxRetries: opts.maxRetries ?? 1,
      });
      clients.set(account, api);
    }
    return api;
  };
}

export type PushResult =
  | { ok: true; account: string; koiboxAppointmentId: number; reused: boolean }
  // "rejected": Koibox dijo que no (o faltan enlaces): seguro que allí no se creó nada.
  //   `taken`: Koibox rechazó la cita en sí (lo normal: esa hora se acaba de ocupar allí).
  // "unknown": se cortó al crear la cita: puede que sí se creara. No se repite a ciegas.
  | { ok: false; outcome: "rejected"; taken: boolean; message: string }
  | { ok: false; outcome: "unknown"; message: string };

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
  opts: {
    apiFor?: KoiboxApiFor;
    now?: Date;
    lookFirst?: boolean;
    // Cambio de hora: crea en Koibox una copia a esta hora y devuelve su id, SIN guardar nada en
    // nuestra cita (lo guarda moveAppointment cuando todo ha ido bien). No se combina con lookFirst.
    at?: { startsAt: Date; endsAt: Date };
  } = {},
): Promise<PushResult> {
  const apiFor = opts.apiFor ?? koiboxApiFor(config);
  const now = opts.now ?? new Date();
  const startsAt = opts.at?.startsAt;
  const endsAt = opts.at?.endsAt;
  // Con `at` no se apunta ningún error en la cita: la cita de antes sigue bien en Koibox
  const recordError = (message: string) => (opts.at ? Promise.resolve() : saveError(appointmentId, message));

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
      staffCollector: staff.collector,
    })
    .from(appointment)
    .innerJoin(service, eq(service.id, appointment.serviceId))
    .innerJoin(staff, eq(staff.id, appointment.staffId))
    .innerJoin(client, eq(client.id, appointment.clientId))
    .where(eq(appointment.id, appointmentId));
  if (!row) return { ok: false, outcome: "rejected", taken: false, message: `No existe la cita ${appointmentId}` };

  // Ya está apuntada: no se crea otra
  if (!opts.at && row.koiboxAccount && row.koiboxAppointmentId !== null) {
    return { ok: true, account: row.koiboxAccount, koiboxAppointmentId: row.koiboxAppointmentId, reused: true };
  }
  if (row.status !== "booked" && row.status !== "pending_deposit") {
    return { ok: false, outcome: "rejected", taken: false, message: `La cita ${appointmentId} está ${row.status}: no se apunta en Koibox` };
  }

  const links = await db.select().from(koiboxServiceMap).where(eq(koiboxServiceMap.serviceId, row.serviceId));
  const routed = resolveKoiboxTarget(
    { staffId: row.staffId, staffName: row.staffName, koiboxAccount: row.staffAccount, koiboxUserId: row.staffUserId },
    row.serviceId,
    links,
    Object.keys(config.koibox.accounts),
  );
  if (!routed.ok) {
    await recordError(routed.message);
    return { ok: false, outcome: "rejected", taken: false, message: routed.message };
  }
  const { account, koiboxUserId, koiboxServiceId } = routed.target;

  const linked = async (koiboxAppointmentId: number, reused: boolean): Promise<PushResult> => {
    if (opts.at) return { ok: true, account, koiboxAppointmentId, reused };
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
    if (opts.lookFirst && !opts.at) {
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
    await recordError(message);
    return { ok: false, outcome: "rejected", taken: false, message };
  }

  let created: KoiboxAppointment;
  try {
    created = await api.createAppointment(
      toKoiboxAppointment({
        ref: row.id,
        serviceName: row.serviceName,
        startsAt: startsAt ?? row.startsAt,
        endsAt: endsAt ?? row.endsAt,
        zone: config.timezone,
        koiboxUserId,
        koiboxClientId,
        koiboxServiceId,
        clientName: row.clientName,
        clientEmail: row.clientEmail,
        deposit:
          row.status === "pending_deposit" && row.depositCents !== null && row.depositDueAt !== null
            ? {
                cents: row.depositCents,
                currency: config.currency,
                dueAt: row.depositDueAt,
                // Con varias titulares, recepción ve en Koibox a quién se paga
                collector: hasSeveralCollectors(config)
                  ? resolveCollector(config, { staffCollector: row.staffCollector, koiboxAccount: row.staffAccount }).label
                  : null,
              }
            : null,
      }),
    );
  } catch (error) {
    const message = errorText(error);
    await recordError(message);
    if (mayHaveArrived(error)) return { ok: false, outcome: "unknown", message };
    const taken = error instanceof KoiboxError && error.code === "bad_request";
    return { ok: false, outcome: "rejected", taken, message };
  }

  // La cita ya existe en Koibox. Si ahora falla guardar su id en nuestra base, no se puede
  // dar por rechazada (allí sí está): queda como "no se sabe" y el reintento la busca.
  try {
    return await linked(created.id, false);
  } catch (error) {
    const message = errorText(`Creada en Koibox (id ${created.id}) pero no se pudo guardar el enlace: ${errorText(error)}`);
    await recordError(message);
    return { ok: false, outcome: "unknown", message };
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

// Cambio de hora: anula en Koibox la cita de la hora anterior (koibox_previous_id) con la nota
// "Cambiada de hora desde la web al …" y lo vacía. Si falla, queda para el reintento.
export async function cleanupPreviousKoibox(
  appointmentId: number,
  config: SalonConfig,
  opts: { apiFor?: KoiboxApiFor; now?: Date } = {},
): Promise<ChangeSyncResult> {
  const apiFor = opts.apiFor ?? koiboxApiFor(config);
  const now = opts.now ?? new Date();
  const [row] = await db
    .select({ account: appointment.koiboxAccount, previousId: appointment.koiboxPreviousId, startsAt: appointment.startsAt })
    .from(appointment)
    .where(eq(appointment.id, appointmentId));
  if (!row?.account || row.previousId === null) return { ok: true, applied: false };

  try {
    const api = apiFor(row.account);
    const old = await api.getAppointment(row.previousId);
    // La borraron en Koibox, o ya estaba anulada: no hay nada que hacer allí
    const patch = old ? koiboxPatchFor({ kind: "moved", startsAt: row.startsAt, zone: config.timezone }, old) : null;
    if (patch) await api.updateAppointment(row.previousId, patch);
    await db
      .update(appointment)
      .set({ koiboxPreviousId: null, koiboxSyncedAt: now, koiboxError: null })
      .where(and(eq(appointment.id, appointmentId), eq(appointment.koiboxPreviousId, row.previousId)));
    return { ok: true, applied: patch !== null };
  } catch (error) {
    const message = `cleanup: ${errorText(error)}`;
    await saveError(appointmentId, message);
    return { ok: false, message };
  }
}

export type NewBookingResult =
  | { ok: true; synced: boolean } // synced: false = no se sabe si llegó; se reintenta más tarde
  | { ok: false; reason: "slot_taken" | "server" };

// Paso final de una reserva web cuando Koibox manda en la agenda: apuntarla allí.
// - Si Koibox la acepta, la reserva vale.
// - Si Koibox dice que no, se anula la nuestra (la clienta ve el error y elige otra hora).
// - Si no se sabe si llegó, la reserva vale: el reintento la busca en Koibox antes de crearla.
export async function pushNewWebBooking(
  appointmentId: number,
  config: SalonConfig,
  opts: { apiFor?: KoiboxApiFor; now?: Date } = {},
): Promise<NewBookingResult> {
  const now = opts.now ?? new Date();
  const pushed = await pushAppointmentToKoibox(appointmentId, config, { ...opts, now });
  if (pushed.ok) return { ok: true, synced: true };
  if (pushed.outcome === "unknown") {
    console.error(`[koibox] cita ${appointmentId}: no se sabe si llegó a Koibox (${pushed.message})`);
    return { ok: true, synced: false };
  }

  console.error(`[koibox] cita ${appointmentId}: Koibox no la aceptó (${pushed.message})`);
  // La condición sobre el estado evita pisar un cambio que haya llegado entretanto
  await db
    .update(appointment)
    .set({ status: "cancelled", cancelledAt: now, cancelReason: "No se pudo apuntar en Koibox" })
    .where(and(eq(appointment.id, appointmentId), inArray(appointment.status, ["booked", "pending_deposit"])));
  return { ok: false, reason: pushed.taken ? "slot_taken" : "server" };
}

// Para después de un cambio hecho en la web o en el panel: si el salón trabaja con Koibox,
// lo lleva allí. Nunca lanza: si falla, queda en koibox_error y lo recoge el reintento.
export async function syncKoiboxChange(
  appointmentId: number,
  change: WebChange,
  config: SalonConfig,
  opts: { apiFor?: KoiboxApiFor; now?: Date } = {},
): Promise<void> {
  if (!writesToKoibox(config)) return;
  try {
    const result = await applyKoiboxChange(appointmentId, change, config, opts);
    if (!result.ok) console.error(`[koibox] cita ${appointmentId}: ${result.message}`);
  } catch (error) {
    console.error(`[koibox] cita ${appointmentId}: no se pudo llevar el cambio a Koibox`, error);
  }
}

// Citas que tienen algo pendiente en Koibox (reintento, depósito pagado o vencido, cancelación).
// Solo mira la última semana y lo que viene: lo más antiguo ya no le importa a recepción.
export async function findPendingKoiboxWork(now: Date = new Date(), limit = 200) {
  const rows = await db
    .select({
      id: appointment.id,
      clientName: appointment.clientName,
      status: appointment.status,
      startsAt: appointment.startsAt,
      koiboxAppointmentId: appointment.koiboxAppointmentId,
      koiboxError: appointment.koiboxError,
      koiboxSyncedAt: appointment.koiboxSyncedAt,
      cancelledAt: appointment.cancelledAt,
      cancelledBy: appointment.cancelledBy,
      cancelReason: appointment.cancelReason,
      depositDueAt: appointment.depositDueAt,
      depositPaidAt: appointment.depositPaidAt,
      koiboxPreviousId: appointment.koiboxPreviousId,
    })
    .from(appointment)
    .where(
      and(
        or(isNotNull(appointment.koiboxAppointmentId), isNotNull(appointment.koiboxError)),
        gt(appointment.startsAt, new Date(now.getTime() - 7 * 24 * 3_600_000)),
      ),
    )
    .orderBy(asc(appointment.startsAt))
    .limit(limit);

  return rows.flatMap((r) => {
    const work = koiboxWorkFor(r, now);
    return work ? [{ id: r.id, clientName: r.clientName, startsAt: r.startsAt, lastError: r.koiboxError, work }] : [];
  });
}

export type PendingSyncSummary = {
  disabled?: true; // el salón no trabaja con Koibox
  expired: number; // depósitos vencidos en esta pasada
  checked: number;
  fixed: number;
  failed: { id: number; message: string }[];
};

// Pone Koibox al día: vence los depósitos que tocan y reintenta todo lo pendiente.
// La llama el cron (/api/cron/koibox) y db/koibox-sync.ts. Repetirla no hace daño.
export async function syncPendingKoibox(
  config: SalonConfig,
  opts: { apiFor?: KoiboxApiFor; now?: Date } = {},
): Promise<PendingSyncSummary> {
  if (!writesToKoibox(config)) return { disabled: true, expired: 0, checked: 0, fixed: 0, failed: [] };
  const now = opts.now ?? new Date();

  // Primero se liberan los depósitos vencidos: así salen abajo como "anular en Koibox"
  const expired = await expireOverdueDeposits(now);
  const pending = await findPendingKoiboxWork(now);
  const summary: PendingSyncSummary = { expired, checked: pending.length, fixed: 0, failed: [] };

  // Una detrás de otra: son pocas y así no se pasa del límite de llamadas de Koibox
  for (const item of pending) {
    const result =
      item.work.kind === "push"
        ? await pushAppointmentToKoibox(item.id, config, { ...opts, now, lookFirst: true })
        : item.work.kind === "cleanup"
          ? await cleanupPreviousKoibox(item.id, config, { ...opts, now })
          : await applyKoiboxChange(item.id, item.work.change, config, { ...opts, now });
    if (result.ok) summary.fixed++;
    else summary.failed.push({ id: item.id, message: result.message });
  }
  return summary;
}

export type RetryResult = { ok: true; done: boolean } | { ok: false; message: string };

// El botón "Reintentar" de una cita en el panel. Decide aquí qué hace falta (la misma regla que el
// reintento automático), sin fiarse de lo que diga el navegador. null = no existe esa cita.
// "missing" (activa y nunca apuntada) también se intenta apuntar, buscando antes para no duplicar.
export async function retryKoiboxSync(
  appointmentId: number,
  config: SalonConfig,
  opts: { apiFor?: KoiboxApiFor; now?: Date } = {},
): Promise<RetryResult | null> {
  const now = opts.now ?? new Date();
  const [row] = await db
    .select({
      status: appointment.status,
      startsAt: appointment.startsAt,
      koiboxAccount: appointment.koiboxAccount,
      koiboxAppointmentId: appointment.koiboxAppointmentId,
      koiboxError: appointment.koiboxError,
      koiboxSyncedAt: appointment.koiboxSyncedAt,
      cancelledAt: appointment.cancelledAt,
      cancelledBy: appointment.cancelledBy,
      cancelReason: appointment.cancelReason,
      depositDueAt: appointment.depositDueAt,
      depositPaidAt: appointment.depositPaidAt,
      koiboxPreviousId: appointment.koiboxPreviousId,
    })
    .from(appointment)
    .where(eq(appointment.id, appointmentId));
  if (!row) return null;

  const state = koiboxCardState(row, now);
  if (!state || state.kind === "synced") return { ok: true, done: false };

  const result =
    state.kind === "missing" || state.work.kind === "push"
      ? await pushAppointmentToKoibox(appointmentId, config, { ...opts, now, lookFirst: true })
      : state.work.kind === "cleanup"
        ? await cleanupPreviousKoibox(appointmentId, config, { ...opts, now })
        : await applyKoiboxChange(appointmentId, state.work.change, config, { ...opts, now });
  return result.ok ? { ok: true, done: true } : { ok: false, message: result.message };
}
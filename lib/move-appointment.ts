// Cambiar una cita de día u hora (misma profesional, servicio y local). La usa la clienta desde
// su enlace (y más adelante el panel). Con Koibox, el orden importa para no dejarla sin cita:
//   1. comprobar la hora nueva (sin contar la propia cita);
//   2. crear la cita nueva en Koibox; si Koibox dice que no, no se toca nada.
//      Si la hora nueva pisa la de ahora, Koibox no deja crearla mientras la vieja ocupa a la misma
//      profesional: entonces se anula antes la vieja y, si la nueva no entra, se recupera;
//   3. guardar la hora nueva en nuestra base (con el id nuevo, y el viejo en koibox_previous_id);
//   4. anular la vieja en Koibox (si no se anuló ya en el paso 2); si falla, lo recoge el reintento.
import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "../db";
import { appointment, emailLog, service, staff } from "../db/schema";
import type { Actor } from "./appointment-changes";
import { getAvailabilityForDay } from "./availability-db";
import { confirmKoiboxSlot, KoiboxUnavailableError, type SnapshotLoader } from "./availability-koibox";
import { pgErrorCode } from "./booking";
import { koiboxPatchFor, webRefLine } from "./koibox/booking";
import type { KoiboxApi } from "./koibox/client";
import { freshKoiboxSnapshot } from "./koibox/snapshot-cache";
import { freesSlot, KOIBOX_STATUS } from "./koibox/statuses";
import { refId } from "./koibox/types";
import {
  cleanupPreviousKoibox, koiboxApiFor, pushAppointmentToKoibox, writesToKoibox, type KoiboxApiFor,
} from "./koibox-sync";
import { toAvailabilityOptions, type SalonConfig } from "./salon-config";

export type MoveResult =
  // koibox: "synced" = todo hecho allí; "pending" = falta algo y lo hará el reintento; "none" = sin Koibox
  | { ok: true; koibox: "synced" | "pending" | "none" }
  | {
      ok: false;
      reason: "not_found" | "not_changeable" | "too_late" | "slot_unavailable" | "slot_taken" | "koibox_unavailable";
    };

export type MoveOptions = {
  actor?: Actor; // "client" respeta el plazo de cancelación
  now?: Date;
  apiFor?: KoiboxApiFor; // en los tests, el Koibox de mentira
  loadFresh?: SnapshotLoader; // ídem, para comprobar la hora con Koibox
};

const MAX_ERROR = 500; // lo que admite la columna koibox_error

export async function moveAppointment(
  appointmentId: number,
  newStartsAt: Date,
  config: SalonConfig,
  opts: MoveOptions = {},
): Promise<MoveResult> {
  const now = opts.now ?? new Date();
  const actor = opts.actor ?? "client";
  const avail = toAvailabilityOptions(config);

  const [appt] = await db
    .select({
      id: appointment.id,
      status: appointment.status,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      staffId: appointment.staffId,
      locationId: appointment.locationId,
      serviceId: appointment.serviceId,
      koiboxAccount: appointment.koiboxAccount,
      koiboxAppointmentId: appointment.koiboxAppointmentId,
      koiboxPreviousId: appointment.koiboxPreviousId,
      koiboxUserId: staff.koiboxUserId,
      durationMin: service.durationMin,
    })
    .from(appointment)
    .innerJoin(service, eq(service.id, appointment.serviceId))
    .innerJoin(staff, eq(staff.id, appointment.staffId))
    .where(eq(appointment.id, appointmentId));
  if (!appt) return { ok: false, reason: "not_found" };
  if (appt.status !== "booked") return { ok: false, reason: "not_changeable" };

  // El plazo se mide sobre la hora ORIGINAL (igual que cancelAppointment)
  const noticeMs = config.booking.cancellationNoticeHours * 3_600_000;
  if (actor === "client" && appt.startsAt.getTime() - now.getTime() < noticeMs) {
    return { ok: false, reason: "too_late" };
  }
  const latest = DateTime.fromJSDate(now, { zone: config.timezone }).plus({ days: config.booking.maxDaysAhead });
  if (newStartsAt.getTime() === appt.startsAt.getTime() || newStartsAt.getTime() > latest.toMillis()) {
    return { ok: false, reason: "slot_unavailable" };
  }
  const newEndsAt = new Date(newStartsAt.getTime() + appt.durationMin * 60_000);
  const koibox = writesToKoibox(config);

  // 1. ¿Está libre la hora nueva? Sin contar la propia cita.
  try {
    if (koibox) {
      const free = await confirmKoiboxSlot(
        appt.locationId, appt.serviceId, appt.staffId, newStartsAt, avail, now, config.koibox,
        opts.loadFresh ?? freshKoiboxSnapshot,
        { appointmentId: appt.id, staffId: appt.staffId, startsAt: appt.startsAt, endsAt: appt.endsAt },
      );
      if (free === null) return { ok: false, reason: "slot_unavailable" };
    } else {
      const date = DateTime.fromJSDate(newStartsAt, { zone: config.timezone }).toFormat("yyyy-MM-dd");
      const slots = await getAvailabilityForDay(appt.locationId, appt.staffId, appt.serviceId, date, avail, now, appt.id);
      if (!slots.some((s) => s.getTime() === newStartsAt.getTime())) return { ok: false, reason: "slot_unavailable" };
    }
  } catch (error) {
    if (error instanceof KoiboxUnavailableError) return { ok: false, reason: "koibox_unavailable" };
    throw error;
  }

  const apiFor = opts.apiFor ?? koiboxApiFor(config);
  const inKoibox = koibox && appt.koiboxAccount !== null && appt.koiboxAppointmentId !== null;

  // Un cambio anterior a medias: antes de nada, anular la cita que sobraba (si no, se perdería)
  if (inKoibox && appt.koiboxPreviousId !== null) {
    const cleaned = await cleanupPreviousKoibox(appt.id, config, { apiFor, now });
    if (!cleaned.ok) return { ok: false, reason: "koibox_unavailable" };
  }

  // 2. Con Koibox: la cita nueva allí, antes de tocar nuestra base
  let newKoiboxId: number | null = null;
  // ¿Se anuló ya la vieja en este paso? (solo cuando la hora nueva pisa la de ahora)
  let freedOld = false;
  let oldNotes: string | null | undefined;
  const oldId = appt.koiboxAppointmentId;
  const api: KoiboxApi | null = inKoibox ? apiFor(appt.koiboxAccount!) : null;

  if (inKoibox && api && oldId !== null) {
    const overlapsOld =
      newStartsAt.getTime() < appt.endsAt.getTime() && newEndsAt.getTime() > appt.startsAt.getTime();
    if (overlapsOld) {
      // Koibox no deja dos citas solapadas de la misma profesional: se libera antes la vieja
      try {
        const current = await api.getAppointment(oldId);
        oldNotes = current?.notas;
        const patch = current
          ? koiboxPatchFor({ kind: "moved", startsAt: newStartsAt, zone: config.timezone }, current)
          : null;
        if (patch) await api.updateAppointment(oldId, patch);
        freedOld = true;
      } catch (error) {
        console.error(`[koibox] cita ${appt.id}: no se pudo liberar la hora de antes`, error);
        return { ok: false, reason: "koibox_unavailable" };
      }
    }

    const created = await pushAppointmentToKoibox(appt.id, config, {
      apiFor,
      now,
      at: { startsAt: newStartsAt, endsAt: newEndsAt },
    });
    if (created.ok) {
      newKoiboxId = created.koiboxAppointmentId;
    } else if (created.outcome === "unknown") {
      // Se cortó: ¿llegó a crearse? Se busca por la referencia web y la hora nueva
      newKoiboxId = await findMovedCopy(appt, newStartsAt, config, api);
    }

    if (newKoiboxId === null) {
      // La nueva no entró: si se liberó la vieja, se recupera. La clienta conserva su cita.
      if (freedOld) await restoreOld(appt.id, api, oldId, oldNotes);
      if (!created.ok && created.outcome === "rejected") {
        console.error(`[koibox] cita ${appt.id}: Koibox no aceptó la hora nueva (${created.message})`);
        return { ok: false, reason: created.taken ? "slot_taken" : "koibox_unavailable" };
      }
      console.error(`[koibox] cita ${appt.id}: no se sabe si se creó la hora nueva`);
      return { ok: false, reason: "koibox_unavailable" };
    }
  }

  // 3. Guardar la hora nueva en nuestra base
  // Si no se puede guardar: se anula la copia y, si hizo falta liberar la vieja, se recupera
  const undoCopy = async () => {
    if (!api || newKoiboxId === null) return;
    try {
      await api.updateAppointment(newKoiboxId, { estado: KOIBOX_STATUS.CANCELLED });
    } catch (error) {
      console.error(`[koibox] cita ${appt.id}: no se pudo anular la copia ${newKoiboxId} en Koibox`, error);
    }
    if (freedOld && oldId !== null) await restoreOld(appt.id, api, oldId, oldNotes);
  };
  try {
    const updated = await db
      .update(appointment)
      .set({
        startsAt: newStartsAt,
        endsAt: newEndsAt,
        rescheduledAt: now,
        ...(newKoiboxId !== null
          ? {
              koiboxAppointmentId: newKoiboxId,
              // Si ya se anuló la vieja (porque pisaba la nueva), no queda nada por limpiar
              koiboxPreviousId: freedOld ? null : appt.koiboxAppointmentId,
              koiboxSyncedAt: now,
              koiboxError: null,
            }
          : {}),
      })
      .where(and(eq(appointment.id, appt.id), eq(appointment.status, "booked")))
      .returning({ id: appointment.id });
    if (updated.length === 0) {
      await undoCopy();
      return { ok: false, reason: "not_changeable" };
    }
  } catch (error) {
    await undoCopy();
    // 23P01: otra reserva se quedó ese hueco en nuestra base un instante antes
    if (pgErrorCode(error) === "23P01") return { ok: false, reason: "slot_taken" };
    throw error;
  }

  // Si ya salió el recordatorio de la hora vieja, que pueda salir el de la nueva
  // (la base solo admite un recordatorio por cita)
  await db.delete(emailLog).where(and(eq(emailLog.appointmentId, appt.id), eq(emailLog.kind, "reminder")));

  // 4. Anular la vieja en Koibox, si no se hizo ya (si falla, queda en koibox_previous_id para el reintento)
  if (newKoiboxId !== null) {
    if (freedOld) return { ok: true, koibox: "synced" };
    const cleaned = await cleanupPreviousKoibox(appt.id, config, { apiFor, now });
    return { ok: true, koibox: cleaned.ok ? "synced" : "pending" };
  }
  // Con Koibox pero sin apuntar todavía: el reintento la apuntará ya con la hora nueva
  return { ok: true, koibox: koibox ? "pending" : "none" };
}

// Si la cita nueva no entró en Koibox, se vuelve a poner la vieja como estaba (Pendiente y sus notas).
// Si ni eso se puede, la cita queda sin enlace y con el error: el reintento la apuntará otra vez
// a su hora (que en nuestra base no ha cambiado). Nunca se queda sin cita.
async function restoreOld(appointmentId: number, api: KoiboxApi, oldId: number, notes: string | null | undefined) {
  try {
    await api.updateAppointment(oldId, {
      estado: KOIBOX_STATUS.PENDING,
      ...(notes != null ? { notas: notes } : {}),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[koibox] cita ${appointmentId}: no se pudo recuperar la cita ${oldId} en Koibox`, error);
    await db
      .update(appointment)
      .set({
        koiboxAppointmentId: null,
        koiboxError: `Cambio de hora fallido: no se pudo recuperar la cita ${oldId} en Koibox (${reason})`.slice(0, MAX_ERROR),
      })
      .where(eq(appointment.id, appointmentId));
  }
}

// Tras un corte al crear la copia: la busca en Koibox (misma referencia web, hora nueva)
async function findMovedCopy(
  appt: { id: number; koiboxAppointmentId: number | null; koiboxUserId: number | null },
  newStartsAt: Date,
  config: SalonConfig,
  api: KoiboxApi,
): Promise<number | null> {
  if (appt.koiboxUserId === null) return null;
  const local = DateTime.fromJSDate(newStartsAt, { zone: config.timezone });
  const day = local.toFormat("yyyy-MM-dd");
  const time = local.toFormat("HH:mm");
  try {
    const list = await api.listAppointments({ from: day, to: day, userIds: [appt.koiboxUserId] });
    const copy = list.find(
      (a) =>
        a.id !== appt.koiboxAppointmentId &&
        !freesSlot(refId(a.estado)) &&
        a.hora_inicio.slice(0, 5) === time &&
        (a.notas ?? "").split("\n")[0].trim() === webRefLine(appt.id),
    );
    return copy?.id ?? null;
  } catch {
    return null;
  }
}
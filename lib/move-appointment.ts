// Cambiar una cita de hora, de profesional o de duración.
// - La clienta, desde su enlace: solo la hora (misma profesional y duración), con el plazo de
//   cambios y los huecos de la web (moveAppointment).
// - Recepción, desde el panel: hora, profesional y duración (moveStaffAppointment). Si se pisa con
//   otra cita no se mueve; fuera de turno, en una ausencia o un bloqueo, solo si lo confirma.
// Las dos terminan en relocate, que hace el cambio en Koibox y en nuestra base. Con Koibox, el
// orden importa para no dejarla sin cita:
//   1. crear la cita nueva en Koibox (en la cuenta de la profesional nueva); si Koibox dice que no,
//      no se toca nada. Si la hora nueva pisa la de ahora con la misma profesional, Koibox no deja
//      crearla mientras la vieja ocupa: entonces se anula antes la vieja y, si la nueva no entra,
//      se recupera;
//   2. guardar el cambio en nuestra base (con el id nuevo, y el viejo en koibox_previous_id/_account);
//   3. anular la vieja en Koibox (si no se anuló ya en el paso 1); si falla, lo recoge el reintento.
import { and, asc, eq, inArray } from "drizzle-orm";
import { DateTime } from "luxon";
import { z } from "zod";
import { db } from "../db";
import { appointment, appointmentService, emailLog, staff } from "../db/schema";
import type { Actor } from "./appointment-changes";
import { resolveServices } from "./appointment-create";
import { getAvailabilityForDay } from "./availability-db";
import { confirmKoiboxSlot, KoiboxUnavailableError, type SnapshotLoader } from "./availability-koibox";
import { pgErrorCode } from "./booking";
import { koiboxPatchFor, webRefLine, type MovedBy } from "./koibox/booking";
import type { KoiboxApi } from "./koibox/client";
import { freshKoiboxSnapshot } from "./koibox/snapshot-cache";
import { freesSlot, KOIBOX_STATUS } from "./koibox/statuses";
import { refId } from "./koibox/types";
import {
  cleanupPreviousKoibox, koiboxApiFor, pushAppointmentToKoibox, writesToKoibox, type KoiboxApiFor,
} from "./koibox-sync";
import { toAvailabilityOptions, type SalonConfig } from "./salon-config";
import type { SlotClash, SlotWarning } from "./slot-check";
import { DURATION_MAX_MIN, DURATION_STEP_MIN } from "./staff-booking";
import { checkStaffSlot } from "./staff-slot";

type AppointmentStatus = typeof appointment.$inferSelect.status;
type KoiboxOutcome = "synced" | "pending" | "none"; // "pending" = falta algo y lo hará el reintento

export type MoveResult =
  | { ok: true; koibox: KoiboxOutcome }
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

// ---------- Lo que se lee de la cita ----------

async function loadAppointment(appointmentId: number) {
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
    })
    .from(appointment)
    .where(eq(appointment.id, appointmentId));
  return appt ?? null;
}

type LoadedAppointment = NonNullable<Awaited<ReturnType<typeof loadAppointment>>>;

// ---------- La clienta, desde su enlace ----------

export async function moveAppointment(
  appointmentId: number,
  newStartsAt: Date,
  config: SalonConfig,
  opts: MoveOptions = {},
): Promise<MoveResult> {
  const now = opts.now ?? new Date();
  const actor = opts.actor ?? "client";
  const avail = toAvailabilityOptions(config);

  const appt = await loadAppointment(appointmentId);
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
  // La duración de la cita, no la del servicio: recepción puede haberla cambiado
  const newEndsAt = new Date(newStartsAt.getTime() + (appt.endsAt.getTime() - appt.startsAt.getTime()));

  // ¿Está libre la hora nueva? Sin contar la propia cita.
  try {
    if (writesToKoibox(config)) {
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

  return relocate(
    appt,
    { startsAt: newStartsAt, endsAt: newEndsAt, staffId: appt.staffId },
    config,
    { now, apiFor: opts.apiFor ?? koiboxApiFor(config), by: "web", statuses: ["booked"] },
  );
}

// ---------- Recepción, desde el panel ----------

const STEP_MS = DURATION_STEP_MIN * 60_000;

export const staffMoveSchema = z.object({
  startsAt: z.coerce.date().refine((d) => d.getTime() % STEP_MS === 0, "La hora va de 5 en 5 minutos"),
  staffId: z.number().int().positive(),
  durationMin: z
    .number()
    .int()
    .min(DURATION_STEP_MIN)
    .max(DURATION_MAX_MIN)
    .refine((m) => m % DURATION_STEP_MIN === 0, "La duración va de 5 en 5 minutos"),
  // Seguir aunque caiga fuera de turno, en una ausencia o un bloqueo (recepción ya vio el aviso)
  force: z.boolean().default(false),
});

export type StaffMoveInput = z.input<typeof staffMoveSchema>;

export type StaffMoveResult =
  | { ok: true; koibox: KoiboxOutcome }
  | { ok: false; reason: "invalid_input"; issues: string[] }
  | {
      ok: false;
      reason: "not_found" | "not_changeable" | "no_change" | "staff_unavailable" | "slot_taken" | "koibox_unavailable";
    }
  | { ok: false; reason: "service_not_done"; serviceNames: string[] }
  | { ok: false; reason: "clash"; clash: SlotClash }
  | { ok: false; reason: "needs_confirmation"; warnings: SlotWarning[] };

export async function moveStaffAppointment(
  appointmentId: number,
  raw: unknown,
  config: SalonConfig,
  opts: { now?: Date; apiFor?: KoiboxApiFor; loadFresh?: SnapshotLoader } = {},
): Promise<StaffMoveResult> {
  const now = opts.now ?? new Date();
  const parsed = staffMoveSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid_input",
      issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }
  const input = parsed.data;

  const appt = await loadAppointment(appointmentId);
  if (!appt) return { ok: false, reason: "not_found" };
  // Recepción puede mover también las que esperan el depósito (su plazo no cambia)
  if (appt.status !== "booked" && appt.status !== "pending_deposit") return { ok: false, reason: "not_changeable" };

  const endsAt = new Date(input.startsAt.getTime() + input.durationMin * 60_000);
  const sameStaff = input.staffId === appt.staffId;
  if (
    sameStaff &&
    input.startsAt.getTime() === appt.startsAt.getTime() &&
    endsAt.getTime() === appt.endsAt.getTime()
  ) {
    return { ok: false, reason: "no_change" };
  }

  // Otra profesional: tiene que estar activa y hacer todos los servicios de la cita
  if (!sameStaff) {
    const [member] = await db.select({ active: staff.active }).from(staff).where(eq(staff.id, input.staffId));
    if (!member?.active) return { ok: false, reason: "staff_unavailable" };

    const lines = await db
      .select({ serviceId: appointmentService.serviceId })
      .from(appointmentService)
      .where(eq(appointmentService.appointmentId, appt.id))
      .orderBy(asc(appointmentService.position));
    const resolved = await resolveServices({
      locationId: appt.locationId,
      staffId: input.staffId,
      serviceIds: lines.length > 0 ? lines.map((l) => l.serviceId) : [appt.serviceId],
    });
    if (!resolved.ok) {
      if (resolved.reason === "unknown_service") return { ok: false, reason: "not_changeable" };
      return { ok: false, reason: "service_not_done", serviceNames: resolved.serviceNames };
    }
  }

  // ¿Cabe? Sin contar la propia cita
  let check;
  try {
    check = await checkStaffSlot({
      staffId: input.staffId,
      locationId: appt.locationId,
      startsAt: input.startsAt,
      endsAt,
      config,
      now,
      ignore: sameStaff
        ? { appointmentId: appt.id, startsAt: appt.startsAt, endsAt: appt.endsAt }
        : { appointmentId: appt.id },
      loadFresh: opts.loadFresh,
    });
  } catch (error) {
    if (error instanceof KoiboxUnavailableError) return { ok: false, reason: "koibox_unavailable" };
    throw error;
  }
  if (!check) return { ok: false, reason: "staff_unavailable" };
  if (check.clash) return { ok: false, reason: "clash", clash: check.clash };
  if (check.warnings.length > 0 && !input.force) {
    return { ok: false, reason: "needs_confirmation", warnings: check.warnings };
  }

  return relocate(
    appt,
    { startsAt: input.startsAt, endsAt, staffId: input.staffId },
    config,
    { now, apiFor: opts.apiFor ?? koiboxApiFor(config), by: "panel", statuses: ["booked", "pending_deposit"] },
  );
}

// ---------- El cambio en Koibox y en nuestra base ----------

type Relocation = { startsAt: Date; endsAt: Date; staffId: number };

type RelocateResult =
  | { ok: true; koibox: KoiboxOutcome }
  | { ok: false; reason: "not_changeable" | "slot_taken" | "koibox_unavailable" };

async function relocate(
  appt: LoadedAppointment,
  to: Relocation,
  config: SalonConfig,
  opts: { now: Date; apiFor: KoiboxApiFor; by: MovedBy; statuses: AppointmentStatus[] },
): Promise<RelocateResult> {
  const koibox = writesToKoibox(config);
  const inKoibox = koibox && appt.koiboxAccount !== null && appt.koiboxAppointmentId !== null;
  const sameStaff = to.staffId === appt.staffId;

  // Un cambio anterior a medias: antes de nada, anular la cita que sobraba (si no, se perdería)
  if (inKoibox && appt.koiboxPreviousId !== null) {
    const cleaned = await cleanupPreviousKoibox(appt.id, config, { apiFor: opts.apiFor, now: opts.now, by: opts.by });
    if (!cleaned.ok) return { ok: false, reason: "koibox_unavailable" };
  }

  // 1. Con Koibox: la cita nueva allí, antes de tocar nuestra base
  let newKoiboxId: number | null = null;
  let newAccount: string | null = null;
  let newApi: KoiboxApi | null = null;
  // ¿Se anuló ya la vieja en este paso? (solo cuando la hora nueva pisa la de ahora)
  let freedOld = false;
  let oldNotes: string | null | undefined;
  const oldId = appt.koiboxAppointmentId;
  const oldApi: KoiboxApi | null = inKoibox ? opts.apiFor(appt.koiboxAccount!) : null;

  if (inKoibox && oldApi && oldId !== null) {
    const overlapsOld =
      sameStaff && to.startsAt.getTime() < appt.endsAt.getTime() && to.endsAt.getTime() > appt.startsAt.getTime();
    if (overlapsOld) {
      // Koibox no deja dos citas solapadas de la misma profesional: se libera antes la vieja
      try {
        const current = await oldApi.getAppointment(oldId);
        oldNotes = current?.notas;
        const patch = current
          ? koiboxPatchFor({ kind: "moved", startsAt: to.startsAt, zone: config.timezone, by: opts.by }, current)
          : null;
        if (patch) await oldApi.updateAppointment(oldId, patch);
        freedOld = true;
      } catch (error) {
        console.error(`[koibox] cita ${appt.id}: no se pudo liberar la hora de antes`, error);
        return { ok: false, reason: "koibox_unavailable" };
      }
    }

    const created = await pushAppointmentToKoibox(appt.id, config, {
      apiFor: opts.apiFor,
      now: opts.now,
      at: to,
    });
    if (created.ok) {
      newKoiboxId = created.koiboxAppointmentId;
      newAccount = created.account;
    } else if (created.outcome === "unknown") {
      // Se cortó: ¿llegó a crearse? Se busca por la referencia web y la hora nueva
      const found = await findMovedCopy(appt.id, oldId, to, config, opts.apiFor);
      if (found) {
        newKoiboxId = found.id;
        newAccount = found.account;
      }
    }

    if (newKoiboxId === null || newAccount === null) {
      // La nueva no entró: si se liberó la vieja, se recupera. La cita sigue como estaba.
      if (freedOld) await restoreOld(appt.id, oldApi, oldId, oldNotes);
      if (!created.ok && created.outcome === "rejected") {
        console.error(`[koibox] cita ${appt.id}: Koibox no aceptó el cambio (${created.message})`);
        return { ok: false, reason: created.taken ? "slot_taken" : "koibox_unavailable" };
      }
      console.error(`[koibox] cita ${appt.id}: no se sabe si se creó la cita nueva`);
      return { ok: false, reason: "koibox_unavailable" };
    }
    newApi = opts.apiFor(newAccount);
  }

  // 2. Guardar el cambio en nuestra base
  // Si no se puede guardar: se anula la copia y, si hizo falta liberar la vieja, se recupera
  const undoCopy = async () => {
    if (!newApi || newKoiboxId === null) return;
    try {
      await newApi.updateAppointment(newKoiboxId, { estado: KOIBOX_STATUS.CANCELLED });
    } catch (error) {
      console.error(`[koibox] cita ${appt.id}: no se pudo anular la copia ${newKoiboxId} en Koibox`, error);
    }
    if (freedOld && oldApi && oldId !== null) await restoreOld(appt.id, oldApi, oldId, oldNotes);
  };
  try {
    const updated = await db
      .update(appointment)
      .set({
        startsAt: to.startsAt,
        endsAt: to.endsAt,
        staffId: to.staffId,
        rescheduledAt: opts.now,
        ...(newKoiboxId !== null
          ? {
              koiboxAccount: newAccount,
              koiboxAppointmentId: newKoiboxId,
              // Si ya se anuló la vieja (porque pisaba la nueva), no queda nada por limpiar
              koiboxPreviousId: freedOld ? null : oldId,
              koiboxPreviousAccount: freedOld ? null : appt.koiboxAccount,
              koiboxSyncedAt: opts.now,
              koiboxError: null,
            }
          : {}),
      })
      .where(and(eq(appointment.id, appt.id), inArray(appointment.status, opts.statuses)))
      .returning({ id: appointment.id });
    if (updated.length === 0) {
      await undoCopy();
      return { ok: false, reason: "not_changeable" };
    }
  } catch (error) {
    await undoCopy();
    // 23P01: otra cita se quedó ese hueco en nuestra base un instante antes
    if (pgErrorCode(error) === "23P01") return { ok: false, reason: "slot_taken" };
    throw error;
  }

  // Si ya salió el recordatorio de la hora vieja, que pueda salir el de la nueva
  // (la base solo admite un recordatorio por cita). Solo si cambió la hora de empezar.
  if (to.startsAt.getTime() !== appt.startsAt.getTime()) {
    await db.delete(emailLog).where(and(eq(emailLog.appointmentId, appt.id), eq(emailLog.kind, "reminder")));
  }

  // 3. Anular la vieja en Koibox, si no se hizo ya (si falla, queda en koibox_previous_id para el reintento)
  if (newKoiboxId !== null) {
    if (freedOld) return { ok: true, koibox: "synced" };
    const cleaned = await cleanupPreviousKoibox(appt.id, config, { apiFor: opts.apiFor, now: opts.now, by: opts.by });
    return { ok: true, koibox: cleaned.ok ? "synced" : "pending" };
  }
  // Con Koibox pero sin apuntar todavía: el reintento la apuntará ya con el cambio
  return { ok: true, koibox: koibox ? "pending" : "none" };
}

// Si la cita nueva no entró en Koibox, se vuelve a poner la vieja como estaba (Pendiente y sus notas).
// Si ni eso se puede, la cita queda sin enlace y con el error: el reintento la apuntará otra vez
// como esté en nuestra base (que no ha cambiado). Nunca se queda sin cita.
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

// Tras un corte al crear la copia: la busca en Koibox, en la cuenta de la profesional nueva
// (misma referencia web, hora nueva)
async function findMovedCopy(
  appointmentId: number,
  oldKoiboxId: number,
  to: Relocation,
  config: SalonConfig,
  apiFor: KoiboxApiFor,
): Promise<{ id: number; account: string } | null> {
  const [member] = await db
    .select({ account: staff.koiboxAccount, userId: staff.koiboxUserId })
    .from(staff)
    .where(eq(staff.id, to.staffId));
  if (!member?.account || member.userId === null) return null;
  const local = DateTime.fromJSDate(to.startsAt, { zone: config.timezone });
  const day = local.toFormat("yyyy-MM-dd");
  const time = local.toFormat("HH:mm");
  try {
    const list = await apiFor(member.account).listAppointments({ from: day, to: day, userIds: [member.userId] });
    const copy = list.find(
      (a) =>
        a.id !== oldKoiboxId &&
        !freesSlot(refId(a.estado)) &&
        a.hora_inicio.slice(0, 5) === time &&
        (a.notas ?? "").split("\n")[0].trim() === webRefLine(appointmentId),
    );
    return copy ? { id: copy.id, account: member.account } : null;
  } catch {
    return null;
  }
}
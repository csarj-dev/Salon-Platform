import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "../db";
import { appointment, service } from "../db/schema";
import { getAvailabilityForDay } from "./availability-db";
import { pgErrorCode, type BookingOptions } from "./booking";
import type { SalonConfig } from "./salon-config";

export type ChangeOptions = { cancellationNoticeHours: number };

export function toChangeOptions(c: SalonConfig): ChangeOptions {
  return { cancellationNoticeHours: c.booking.cancellationNoticeHours };
}

// "client": la clienta desde la web (sujeta al plazo)
// "staff": recepción o responsable (puede saltarse el plazo)
export type Actor = "client" | "staff";

export type ChangeResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "not_found"
        | "not_changeable"
        | "too_late"
        | "slot_unavailable"
        | "slot_taken";
    };

// Cierto si faltan menos horas de las exigidas (o la cita ya pasó)
function withinNoticeWindow(startsAt: Date, now: Date, hours: number): boolean {
  return startsAt.getTime() - now.getTime() < hours * 3_600_000;
}

export async function cancelAppointment(
  appointmentId: number,
  opts: ChangeOptions,
  actor: Actor = "client",
  now: Date = new Date(),
): Promise<ChangeResult> {
  const [appt] = await db.select().from(appointment).where(eq(appointment.id, appointmentId));
  if (!appt) return { ok: false, reason: "not_found" };
  if (appt.status !== "booked") return { ok: false, reason: "not_changeable" };

  if (actor === "client" && withinNoticeWindow(appt.startsAt, now, opts.cancellationNoticeHours)) {
    return { ok: false, reason: "too_late" };
  }

  // La condición sobre el estado evita cancelar dos veces si hay dos peticiones a la vez
  const updated = await db
    .update(appointment)
    .set({ status: "cancelled", cancelledAt: now })
    .where(and(eq(appointment.id, appointmentId), eq(appointment.status, "booked")))
    .returning({ id: appointment.id });

  if (updated.length === 0) return { ok: false, reason: "not_changeable" };
  return { ok: true };
}

// Mueve la cita a otra hora, con la misma profesional, servicio y local
export async function rescheduleAppointment(
  appointmentId: number,
  newStartsAt: Date,
  bookingOpts: BookingOptions,
  changeOpts: ChangeOptions,
  actor: Actor = "client",
  now: Date = new Date(),
): Promise<ChangeResult> {
  const [appt] = await db.select().from(appointment).where(eq(appointment.id, appointmentId));
  if (!appt) return { ok: false, reason: "not_found" };
  if (appt.status !== "booked") return { ok: false, reason: "not_changeable" };

  // El plazo se mide sobre la hora ORIGINAL de la cita
  if (actor === "client" && withinNoticeWindow(appt.startsAt, now, changeOpts.cancellationNoticeHours)) {
    return { ok: false, reason: "too_late" };
  }

  // No más allá del máximo de días hacia adelante
  const latest = DateTime.fromJSDate(now, { zone: bookingOpts.zone }).plus({
    days: bookingOpts.maxDaysAhead,
  });
  if (newStartsAt.getTime() > latest.toMillis()) {
    return { ok: false, reason: "slot_unavailable" };
  }

  const date = DateTime.fromJSDate(newStartsAt, { zone: bookingOpts.zone }).toISODate();
  if (!date) return { ok: false, reason: "slot_unavailable" };

  // El hueco nuevo debe estar libre, sin contar la propia cita
  const slots = await getAvailabilityForDay(
    appt.locationId,
    appt.staffId,
    appt.serviceId,
    date,
    bookingOpts,
    now,
    appt.id,
  );
  if (!slots.some((s) => s.getTime() === newStartsAt.getTime())) {
    return { ok: false, reason: "slot_unavailable" };
  }

  const [svc] = await db
    .select({ durationMin: service.durationMin })
    .from(service)
    .where(eq(service.id, appt.serviceId));
  if (!svc) throw new Error(`Servicio ${appt.serviceId} no existe`);

  const newEndsAt = new Date(newStartsAt.getTime() + svc.durationMin * 60_000);

  try {
    const updated = await db
      .update(appointment)
      .set({ startsAt: newStartsAt, endsAt: newEndsAt })
      .where(and(eq(appointment.id, appointmentId), eq(appointment.status, "booked")))
      .returning({ id: appointment.id });

    if (updated.length === 0) return { ok: false, reason: "not_changeable" };
    return { ok: true };
  } catch (e) {
    // 23P01 = exclusion_violation: otra reserva se quedó ese hueco un instante antes
    if (pgErrorCode(e) === "23P01") return { ok: false, reason: "slot_taken" };
    throw e;
  }
}
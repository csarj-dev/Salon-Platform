import { and, eq, ne, lt, gt, or, notInArray } from "drizzle-orm";
import { db } from "../db";
import { schedule, appointment, timeOff } from "../db/schema";
import { dayRange, buildWorkingHours } from "./working-hours";
import { getAvailableSlots } from "./availability";
import { loadServiceSet, staffDoingAll, type ServiceIds } from "./service-set";

export type AvailabilityOptions = {
  zone: string;
  stepMin: number;
  bufferMin: number;
  minNoticeHours: number;
};

export async function getAvailabilityForDay(
  locationId: number,
  staffId: number,
  services: ServiceIds, // uno o varios seguidos
  date: string, // "2026-11-02", fecha local del salón
  opts: AvailabilityOptions,
  now: Date = new Date(),
  ignoreAppointmentId?: number, // para mover una cita sin que se bloquee a sí misma
): Promise<Date[]> {
  // 1. ¿Existen los servicios, los ofrece este local y los hace todos esta profesional?
  const set = await loadServiceSet(locationId, services);
  if (!set) return [];
  if (!(await staffDoingAll(set.ids)).includes(staffId)) return [];

  // 2. Rango del día y datos de la base de datos
  const range = dayRange(date, opts.zone);

  // Turnos: solo los de este local
  const scheduleRows = await db
    .select({
      weekday: schedule.weekday,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
    })
    .from(schedule)
    .where(and(eq(schedule.staffId, staffId), eq(schedule.locationId, locationId)));

  // Citas: de la profesional en cualquier local (no puede estar en dos sitios)
  const appts = await db
    .select({ start: appointment.startsAt, end: appointment.endsAt })
    .from(appointment)
    .where(
      and(
        eq(appointment.staffId, staffId),
        // Canceladas y caducadas no ocupan hueco
        notInArray(appointment.status, ["cancelled", "expired"]),
        // Una pendiente de depósito ocupa el hueco solo mientras no venza su plazo
        or(ne(appointment.status, "pending_deposit"), gt(appointment.depositDueAt, now)),
        lt(appointment.startsAt, range.end),
        gt(appointment.endsAt, range.start),
        ignoreAppointmentId !== undefined
          ? ne(appointment.id, ignoreAppointmentId)
          : undefined,
      ),
    );

  const offs = await db
    .select({ start: timeOff.startsAt, end: timeOff.endsAt })
    .from(timeOff)
    .where(
      and(
        eq(timeOff.staffId, staffId),
        lt(timeOff.startsAt, range.end),
        gt(timeOff.endsAt, range.start),
      ),
    );

  // 3. Funciones puras
  return getAvailableSlots({
    workingHours: buildWorkingHours(date, opts.zone, scheduleRows),
    busy: [...appts, ...offs],
    durationMin: set.durationMin,
    stepMin: opts.stepMin,
    bufferMin: opts.bufferMin,
    now,
    minNoticeHours: opts.minNoticeHours,
  });
}
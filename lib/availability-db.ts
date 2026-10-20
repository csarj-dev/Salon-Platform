import { and, eq, ne, lt, gt } from "drizzle-orm";
import { db } from "../db";
import {
  service, staffService, locationService, schedule, appointment, timeOff,
} from "../db/schema";
import { dayRange, buildWorkingHours } from "./working-hours";
import { getAvailableSlots } from "./availability";

export type AvailabilityOptions = {
  zone: string;
  stepMin: number;
  bufferMin: number;
  minNoticeHours: number;
};

export async function getAvailabilityForDay(
  locationId: number,
  staffId: number,
  serviceId: number,
  date: string, // "2026-11-02", fecha local del salón
  opts: AvailabilityOptions,
  now: Date = new Date(),
  ignoreAppointmentId?: number, // para mover una cita sin que se bloquee a sí misma
): Promise<Date[]> {
  // 1. ¿Existe el servicio, lo ofrece este local y lo hace esta profesional?
  const [svc] = await db
    .select({ durationMin: service.durationMin })
    .from(service)
    .where(eq(service.id, serviceId));
  if (!svc) throw new Error(`Servicio ${serviceId} no existe`);

  const [offeredHere] = await db
    .select()
    .from(locationService)
    .where(
      and(
        eq(locationService.locationId, locationId),
        eq(locationService.serviceId, serviceId),
      ),
    );
  if (!offeredHere) return [];

  const [staffCanDo] = await db
    .select()
    .from(staffService)
    .where(and(eq(staffService.staffId, staffId), eq(staffService.serviceId, serviceId)));
  if (!staffCanDo) return [];

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
        ne(appointment.status, "cancelled"),
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
    durationMin: svc.durationMin,
    stepMin: opts.stepMin,
    bufferMin: opts.bufferMin,
    now,
    minNoticeHours: opts.minNoticeHours,
  });
}
import { and, eq, ne, lt, gt } from "drizzle-orm";
import { db } from "../db";
import { service, staffService, schedule, appointment, timeOff } from "../db/schema";
import { dayRange, buildWorkingHours } from "./working-hours";
import { getAvailableSlots } from "./availability";

export type AvailabilityOptions = {
  zone: string;
  stepMin: number;
  bufferMin: number;
  minNoticeHours: number;
};

export async function getAvailabilityForDay(
  staffId: number,
  serviceId: number,
  date: string, // "2026-11-02", fecha local del salón
  opts: AvailabilityOptions,
  now: Date = new Date(),
): Promise<Date[]> {
  // 1. ¿Existe el servicio y lo hace esta profesional?
  const [svc] = await db
    .select({ durationMin: service.durationMin })
    .from(service)
    .where(eq(service.id, serviceId));
  if (!svc) throw new Error(`Servicio ${serviceId} no existe`);

  const [link] = await db
    .select()
    .from(staffService)
    .where(and(eq(staffService.staffId, staffId), eq(staffService.serviceId, serviceId)));
  if (!link) return [];

  // 2. Rango del día y datos de la base de datos
  const range = dayRange(date, opts.zone);

  const scheduleRows = await db
    .select({
      weekday: schedule.weekday,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
    })
    .from(schedule)
    .where(eq(schedule.staffId, staffId));

  const appts = await db
    .select({ start: appointment.startsAt, end: appointment.endsAt })
    .from(appointment)
    .where(
      and(
        eq(appointment.staffId, staffId),
        ne(appointment.status, "cancelled"),
        lt(appointment.startsAt, range.end),
        gt(appointment.endsAt, range.start),
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
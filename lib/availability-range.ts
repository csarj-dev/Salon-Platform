import { and, asc, eq, gt, inArray, lt, notInArray, ne, or } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "../db";
import {
  appointment, locationService, schedule, service, staff, staffService, timeOff,
} from "../db/schema";
import { getAvailableSlots, type Interval } from "./availability";
import type { AvailabilityOptions } from "./availability-db";
import type { ServiceAvailability } from "./availability-service";
import { mergeSlots, type StaffSlots } from "./merge-slots";
import { buildWorkingHours, dayRange } from "./working-hours";

const DAY_FORMAT = "yyyy-MM-dd";

// Huecos de un servicio en un local para TODOS los días entre dos fechas, con un número
// fijo de consultas (unas 6) sea cual sea el rango. Es lo que necesita el calendario:
// pedir los huecos día a día serían cientos de consultas por visita.
//
// Devuelve un mapa "2026-11-02" -> huecos de ese día. Los días sin ningún hueco no aparecen.
// El resultado es el mismo que si se llamara a getAvailabilityForService día por día
// (lo comprueba tests/availability-range.test.ts).
export async function getAvailabilityForRange(
  locationId: number,
  serviceId: number,
  fromDate: string, // "2026-11-02", fecha local del salón
  toDate: string, // incluido
  opts: AvailabilityOptions,
  now: Date = new Date(),
): Promise<Map<string, ServiceAvailability>> {
  const result = new Map<string, ServiceAvailability>();
  if (toDate < fromDate) return result;

  // 1. ¿Existe el servicio y lo ofrece este local?
  const [svc] = await db
    .select({ durationMin: service.durationMin })
    .from(service)
    .where(eq(service.id, serviceId));
  if (!svc) return result;

  const [offeredHere] = await db
    .select()
    .from(locationService)
    .where(and(eq(locationService.locationId, locationId), eq(locationService.serviceId, serviceId)));
  if (!offeredHere) return result;

  // 2. Profesionales activas que hacen el servicio
  const team = await db
    .select({ id: staff.id, name: staff.name })
    .from(staff)
    .innerJoin(staffService, eq(staffService.staffId, staff.id))
    .where(and(eq(staffService.serviceId, serviceId), eq(staff.active, true)))
    .orderBy(asc(staff.name));
  if (team.length === 0) return result;
  const teamIds = team.map((m) => m.id);

  // 3. Todo lo que afecta a esas profesionales en el rango, de una vez
  const range: Interval = {
    start: dayRange(fromDate, opts.zone).start,
    end: dayRange(toDate, opts.zone).end,
  };

  const [scheduleRows, appts, offs] = await Promise.all([
    // Turnos: solo los de este local
    db
      .select({
        staffId: schedule.staffId,
        weekday: schedule.weekday,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
      })
      .from(schedule)
      .where(and(inArray(schedule.staffId, teamIds), eq(schedule.locationId, locationId))),

    // Citas: en cualquier local (una persona no puede estar en dos sitios).
    // Canceladas y caducadas no ocupan; una pendiente de depósito, solo hasta que venza su plazo.
    db
      .select({ staffId: appointment.staffId, start: appointment.startsAt, end: appointment.endsAt })
      .from(appointment)
      .where(
        and(
          inArray(appointment.staffId, teamIds),
          notInArray(appointment.status, ["cancelled", "expired"]),
          or(ne(appointment.status, "pending_deposit"), gt(appointment.depositDueAt, now)),
          lt(appointment.startsAt, range.end),
          gt(appointment.endsAt, range.start),
        ),
      ),

    db
      .select({ staffId: timeOff.staffId, start: timeOff.startsAt, end: timeOff.endsAt })
      .from(timeOff)
      .where(
        and(
          inArray(timeOff.staffId, teamIds),
          lt(timeOff.startsAt, range.end),
          gt(timeOff.endsAt, range.start),
        ),
      ),
  ]);

  // 4. Día a día, en memoria, con las mismas funciones puras de siempre
  const byStaff = new Map(
    team.map((m) => [
      m.id,
      {
        schedule: scheduleRows.filter((r) => r.staffId === m.id),
        busy: [...appts, ...offs].filter((b) => b.staffId === m.id),
      },
    ]),
  );

  let day = DateTime.fromISO(fromDate, { zone: opts.zone });
  for (let iso = day.toFormat(DAY_FORMAT); iso <= toDate; iso = day.toFormat(DAY_FORMAT)) {
    const dayBounds = dayRange(iso, opts.zone);
    const perStaff: StaffSlots[] = [];

    for (const member of team) {
      const data = byStaff.get(member.id)!;
      const slots = getAvailableSlots({
        workingHours: buildWorkingHours(iso, opts.zone, data.schedule),
        busy: data.busy.filter(
          (b) => b.start.getTime() < dayBounds.end.getTime() && b.end.getTime() > dayBounds.start.getTime(),
        ),
        durationMin: svc.durationMin,
        stepMin: opts.stepMin,
        bufferMin: opts.bufferMin,
        now,
        minNoticeHours: opts.minNoticeHours,
      });
      if (slots.length > 0) perStaff.push({ staffId: member.id, staffName: member.name, slots });
    }

    if (perStaff.length > 0) result.set(iso, { perStaff, any: mergeSlots(perStaff) });
    day = day.plus({ days: 1 });
  }

  return result;
}
import { and, asc, eq, gt, lt } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "../db";
import { location, schedule, staff, timeOff } from "../db/schema";
import type { Interval } from "./availability";
import { buildWorkingHours, dayRange } from "./working-hours";

export type AgendaShift = Interval & { locationId: number; locationName: string };

export type AgendaColumn = {
  staffId: number;
  staffName: string;
  /** Turnos de ese día (en el local elegido, si hay filtro), en orden */
  shifts: AgendaShift[];
  /** Ausencias de ese día, recortadas al día */
  timeOff: Interval[];
  /** Tiene turno ese día */
  working: boolean;
};

/**
 * Las columnas de la agenda de un día, una por profesional, con sus turnos y ausencias.
 * Salen las que trabajan ese día; con `all`, también las demás (del local elegido, o todas).
 * Las de `withAppointments` salen siempre: una cita nunca se queda sin columna,
 * aunque su profesional no tenga turno ese día o ya no esté activa.
 */
export async function loadAgendaColumns(opts: {
  date: string; // "2026-11-16", día en la zona del salón
  zone: string;
  locationId?: number;
  all?: boolean;
  withAppointments?: number[];
}): Promise<AgendaColumn[]> {
  const day = dayRange(opts.date, opts.zone);
  const weekday = DateTime.fromISO(opts.date, { zone: opts.zone }).weekday; // 1 = lunes
  const extra = new Set(opts.withAppointments ?? []);

  const [team, rows, absences] = await Promise.all([
    db
      .select({ id: staff.id, name: staff.name, active: staff.active })
      .from(staff)
      .orderBy(asc(staff.name)),
    // Todos los días de la semana: con `all` hace falta saber quién es de ese local
    db
      .select({
        staffId: schedule.staffId,
        locationId: schedule.locationId,
        locationName: location.name,
        weekday: schedule.weekday,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
      })
      .from(schedule)
      .innerJoin(location, eq(location.id, schedule.locationId))
      .where(opts.locationId ? eq(schedule.locationId, opts.locationId) : undefined),
    db
      .select({ staffId: timeOff.staffId, start: timeOff.startsAt, end: timeOff.endsAt })
      .from(timeOff)
      .where(and(lt(timeOff.startsAt, day.end), gt(timeOff.endsAt, day.start))),
  ]);

  const columns: AgendaColumn[] = [];
  for (const s of team) {
    const mine = rows.filter((r) => r.staffId === s.id);
    const shifts: AgendaShift[] = mine
      .filter((r) => r.weekday === weekday)
      .flatMap((r) =>
        buildWorkingHours(opts.date, opts.zone, [r]).map((interval) => ({
          ...interval,
          locationId: r.locationId,
          locationName: r.locationName,
        })),
      )
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    const working = s.active && shifts.length > 0;
    const belongs = s.active && (opts.locationId ? mine.length > 0 : true);
    if (!working && !extra.has(s.id) && !(opts.all && belongs)) continue;

    columns.push({
      staffId: s.id,
      staffName: s.name,
      shifts: s.active ? shifts : [],
      timeOff: absences
        .filter((a) => a.staffId === s.id)
        .map((a) => ({
          start: new Date(Math.max(a.start.getTime(), day.start.getTime())),
          end: new Date(Math.min(a.end.getTime(), day.end.getTime())),
        })),
      working,
    });
  }
  return columns;
}
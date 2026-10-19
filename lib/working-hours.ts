import { DateTime } from "luxon";
import { localToInstant } from "./timezone";
import type { Interval } from "./availability";

export type ScheduleRow = { weekday: number; startTime: string; endTime: string };

// Turnos de un día concreto, como instantes reales y ordenados
export function buildWorkingHours(
  date: string,
  zone: string,
  rows: ScheduleRow[],
): Interval[] {
  const weekday = DateTime.fromISO(date, { zone }).weekday; // 1 = lunes ... 7 = domingo
  return rows
    .filter((r) => r.weekday === weekday)
    .map((r) => ({
      start: localToInstant(date, r.startTime, zone),
      end: localToInstant(date, r.endTime, zone),
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

// Desde las 00:00 locales hasta las 00:00 locales del día siguiente
export function dayRange(date: string, zone: string): Interval {
  const start = DateTime.fromISO(date, { zone }).startOf("day");
  return { start: start.toJSDate(), end: start.plus({ days: 1 }).toJSDate() };
}
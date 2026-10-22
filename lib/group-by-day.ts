import { DateTime } from "luxon";

export type DayGroup<T> = { day: string; date: Date; rows: T[] };

// Agrupa filas ya ordenadas por hora en bloques por día, según la zona del salón
export function groupByDay<T extends { startsAt: Date }>(rows: T[], zone: string): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const row of rows) {
    const day = DateTime.fromJSDate(row.startsAt, { zone }).toISODate();
    if (!day) continue;
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(row);
    else groups.push({ day, date: row.startsAt, rows: [row] });
  }
  return groups;
}
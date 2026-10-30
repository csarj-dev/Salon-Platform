// Turnos, citas y bloqueos de Koibox traducidos a lo que usan nuestras funciones de huecos
// (lib/availability.ts): tramos de trabajo y tramos ocupados de una profesional en un día.
// Lógica pura: los datos llegan ya descargados en un `KoiboxSnapshot` (ver snapshot.ts).
import { DateTime } from "luxon";
import type { Interval } from "../availability";
import { localToInstant } from "../timezone";
import type { KoiboxSchedule, KoiboxScheduleDay } from "./types";

// Lo que necesitamos de una cuenta de Koibox para calcular huecos, ya simplificado.
// Son datos planos (sin clases ni fechas) para poder guardarlos en caché.
export type KoiboxSnapshot = {
  schedules: KoiboxSchedule[];
  appointments: { userId: number; date: string; start: string; end: string }[]; // solo las que ocupan hueco
  blocks: { userId: number; date: string; start: string; end: string; recurrence: string }[];
};

export type LocalShift = { start: string; end: string }; // "09:00:00", hora local del centro

// Nombre del campo de cada día en Koibox (1 = lunes ... 7 = domingo, como luxon)
export const WEEKDAY_FIELDS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"] as const;

function toShifts(day: KoiboxScheduleDay): LocalShift[] {
  if (!day) return [];
  const list = Array.isArray(day) ? day : [day];
  return list
    .filter((s) => s && s.hora_inicio && s.hora_fin && s.hora_inicio < s.hora_fin)
    .map((s) => ({ start: s.hora_inicio, end: s.hora_fin }))
    .sort((a, b) => a.start.localeCompare(b.start));
}

// Turnos de una profesional un día concreto. Manda el horario de esa semana si existe;
// si no, su horario de siempre. Sin horario, ese día no trabaja.
export function shiftsOn(schedules: KoiboxSchedule[], userId: number, date: string): LocalShift[] {
  const d = DateTime.fromISO(date);
  const week = String(d.weekNumber).padStart(2, "0");
  const year = String(d.weekYear);
  const mine = schedules.filter((s) => s.user === userId);
  const row =
    mine.find((s) => s.week === week && s.year === year) ?? mine.find((s) => !s.week && !s.year);
  if (!row) return [];
  return toShifts(row[WEEKDAY_FIELDS[d.weekday - 1]]);
}

// ¿Cae un bloqueo en esta fecha? Las repeticiones cuentan desde su `fecha`, sin fin.
// Pendiente de confirmar con una clave real cómo repite Koibox exactamente.
export function blockOccursOn(block: { date: string; recurrence: string }, date: string): boolean {
  if (date < block.date) return false;
  const from = DateTime.fromISO(block.date);
  const day = DateTime.fromISO(date);
  switch (block.recurrence) {
    case "day_1___":
      return true;
    case "week_1___":
      return day.weekday === from.weekday;
    case "week_2___": {
      const days = Math.round(day.diff(from, "days").days);
      return days % 14 === 0;
    }
    case "month_1___":
      return day.day === from.day;
    default: // "none" o algo que no conocemos: solo ese día
      return date === block.date;
  }
}

// Turnos de una profesional ese día, como instantes reales
export function workingHoursOn(snapshot: KoiboxSnapshot, userId: number, date: string, zone: string): Interval[] {
  return shiftsOn(snapshot.schedules, userId, date).map((s) => ({
    start: localToInstant(date, s.start, zone),
    end: localToInstant(date, s.end, zone),
  }));
}

// Lo que tiene ocupado ese día en Koibox: citas y bloqueos
export function busyOn(snapshot: KoiboxSnapshot, userId: number, date: string, zone: string): Interval[] {
  const toInterval = (x: { start: string; end: string }) => ({
    start: localToInstant(date, x.start, zone),
    end: localToInstant(date, x.end, zone),
  });
  const appointments = snapshot.appointments.filter((a) => a.userId === userId && a.date === date);
  const blocks = snapshot.blocks.filter((b) => b.userId === userId && blockOccursOn(b, date));
  return [...appointments, ...blocks].filter((x) => x.start < x.end).map(toInterval);
}
import type { Interval } from "./availability";
import { DateTime } from "luxon";

// Cálculos de la agenda que no tocan la base de datos: qué horas se enseñan y dónde va cada cita.
// Las posiciones van en minutos desde el inicio de la ventana; la página las pasa a píxeles.

const MIN = 60_000;
const HOUR = 60 * MIN;

export type AgendaWindow = {
  start: Date;
  end: Date;
  /** Una por hora entera, para las etiquetas de la izquierda */
  hours: Date[];
};

/**
 * Las horas que enseña la agenda de un día: de la primera entrada (o cita) a la última
 * salida, redondeado a horas enteras. Sin nada ese día, el horario por defecto.
 * `startOfDay`: las 00:00 de ese día en la zona del salón.
 */
export function agendaWindow(
  intervals: Interval[],
  startOfDay: Date,
  fallback: { from: number; to: number } = { from: 9, to: 20 },
): AgendaWindow {
  const sod = startOfDay.getTime();
  let from = sod + fallback.from * HOUR;
  let to = sod + fallback.to * HOUR;

  if (intervals.length > 0) {
    const first = Math.min(...intervals.map((i) => i.start.getTime()));
    const last = Math.max(...intervals.map((i) => i.end.getTime()));
    // Redondeo a horas contando desde las 00:00 del salón (los cambios de hora son de una hora entera)
    from = Math.max(sod, sod + Math.floor((first - sod) / HOUR) * HOUR);
    to = Math.min(sod + 24 * HOUR, sod + Math.ceil((last - sod) / HOUR) * HOUR);
  }

  const hours: Date[] = [];
  for (let t = from; t < to; t += HOUR) hours.push(new Date(t));
  return { start: new Date(from), end: new Date(to), hours };
}

export type Placed<T> = {
  item: T;
  /** Minutos desde el inicio de la ventana */
  top: number;
  /** Minutos de alto (como poco `minHeight`, para que se pueda pulsar) */
  height: number;
  /** Carril dentro de la columna y cuántos carriles hay en su grupo (citas que se pisan) */
  lane: number;
  lanes: number;
};

/**
 * Coloca las citas de una columna. Si dos se pisan (no debería pasar, pero puede venir así
 * de Koibox o de un cambio a mano), se ponen una al lado de la otra en vez de taparse.
 */
export function placeInColumn<T extends Interval>(items: T[], window: AgendaWindow, minHeight = 15): Placed<T>[] {
  const ws = window.start.getTime();
  const we = window.end.getTime();
  const sorted = [...items].sort(
    (a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime(),
  );

  const placed: Placed<T>[] = [];
  let group: Placed<T>[] = [];
  let laneEnds: number[] = [];
  let groupEnd = -Infinity;

  const closeGroup = () => {
    for (const p of group) p.lanes = laneEnds.length;
    group = [];
    laneEnds = [];
  };

  for (const item of sorted) {
    const start = item.start.getTime();
    const end = item.end.getTime();
    if (start >= groupEnd) {
      closeGroup();
      groupEnd = -Infinity;
    }

    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }
    groupEnd = Math.max(groupEnd, end);

    const top = Math.max(0, (start - ws) / MIN);
    const bottom = Math.min(we, end);
    const p: Placed<T> = {
      item,
      top,
      height: Math.max(minHeight, (bottom - ws) / MIN - top),
      lane,
      lanes: 1,
    };
    group.push(p);
    placed.push(p);
  }
  closeGroup();
  return placed;
}

/**
 * Lunes y domingo de la semana de un día ("2026-11-14" → del "2026-11-09" al "2026-11-15").
 * La agenda pide a Koibox la semana entera: moverse entre los días de esa semana no gasta
 * peticiones (Koibox admite 60 por minuto por IP, para todas las cuentas juntas).
 */
export function weekOf(date: string): { from: string; to: string } {
  const d = DateTime.fromISO(date);
  const monday = d.minus({ days: d.weekday - 1 });
  return { from: monday.toISODate()!, to: monday.plus({ days: 6 }).toISODate()! };
}

/** Lo que queda de `from` al quitarle los tramos de `minus` (en orden y sin solapes). */
export function subtractIntervals(from: Interval[], minus: Interval[]): Interval[] {
  const cuts = [...minus].sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: Interval[] = [];
  for (const piece of [...from].sort((a, b) => a.start.getTime() - b.start.getTime())) {
    let cursor = piece.start.getTime();
    const end = piece.end.getTime();
    for (const c of cuts) {
      const cs = c.start.getTime();
      const ce = c.end.getTime();
      if (ce <= cursor || cs >= end) continue;
      if (cs > cursor) out.push({ start: new Date(cursor), end: new Date(cs) });
      cursor = Math.max(cursor, ce);
      if (cursor >= end) break;
    }
    if (cursor < end) out.push({ start: new Date(cursor), end: new Date(end) });
  }
  return out;
}

/** Minutos que suman unos tramos. */
export function minutesOf(list: Interval[]): number {
  return list.reduce((sum, i) => sum + (i.end.getTime() - i.start.getTime()) / MIN, 0);
}

export type DaySummary =
  | { kind: "off" } // no trabaja ese día
  | { kind: "absent" } // trabajaba, pero una ausencia o un bloqueo tapa todo el turno
  | { kind: "full" } // sin huecos
  | { kind: "free"; minutes: number };

/**
 * Huecos libres de una profesional un día y el resumen de su casilla en la Semana.
 * `busy`: sus citas que ocupan hueco (nuestras y, en modo Koibox, también las de Koibox).
 * Huecos de menos de `minGap` minutos no cuentan: no cabe ningún servicio.
 */
export function daySummary(
  day: { working: boolean; shifts: Interval[]; timeOff: Interval[]; blocks: Interval[] },
  busy: Interval[],
  minGap = 15,
): { summary: DaySummary; free: Interval[] } {
  if (!day.working) return { summary: { kind: "off" }, free: [] };
  if (subtractIntervals(day.shifts, [...day.timeOff, ...day.blocks]).length === 0) {
    return { summary: { kind: "absent" }, free: [] };
  }
  const free = subtractIntervals(day.shifts, [...busy, ...day.timeOff, ...day.blocks]).filter(
    (i) => minutesOf([i]) >= minGap,
  );
  const minutes = minutesOf(free);
  return { summary: minutes === 0 ? { kind: "full" } : { kind: "free", minutes }, free };
}

/**
 * Los huecos libres en los que todavía se puede crear una cita: lo que aún no ha pasado, desde la
 * siguiente hora redonda de `stepMin` minutos, y solo si queda al menos `minGap`.
 */
export function openGaps(free: Interval[], now: Date, minGap = 15, stepMin = 5): Interval[] {
  const step = stepMin * MIN;
  const from = Math.ceil(now.getTime() / step) * step;
  return free.flatMap((g) => {
    const start = Math.max(g.start.getTime(), from);
    return g.end.getTime() - start >= minGap * MIN ? [{ start: new Date(start), end: g.end }] : [];
  });
}

/**
 * «Nueva cita» en la dirección de la página: "1" = el panel vacío (botón «+ Nueva cita»);
 * "<profesional>@<hora>" = desde un hueco libre ("29@12:30"). Cualquier otra cosa: cerrado.
 */
export function parseNewSlot(v: string | undefined): { staffId?: number; time?: string } | null {
  if (v === "1") return {};
  const m = /^(\d{1,9})@([01]\d|2[0-3]):([0-5]\d)$/.exec(v ?? "");
  if (!m || Number(m[1]) <= 0) return null;
  return { staffId: Number(m[1]), time: `${m[2]}:${m[3]}` };
}
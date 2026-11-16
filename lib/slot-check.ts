// ¿Cabe una cita a esta hora con esta profesional? Lógica pura: los datos llegan ya cargados
// (lib/staff-slot.ts). Dos cosas distintas:
// - choque: se pisa con otra cita (nuestra o apuntada solo en Koibox). No se puede guardar:
//   ni la base de datos ni Koibox admiten dos citas de la misma profesional a la vez.
// - avisos: fuera de turno, en una ausencia o en un bloqueo. Se puede guardar si recepción lo confirma.
import type { Interval } from "./availability";

export type SlotAppointment = { id: number; clientName: string; startsAt: Date; endsAt: Date };

export type SlotClash =
  | { kind: "appointment"; appointment: SlotAppointment }
  | { kind: "koibox"; startsAt: Date; endsAt: Date }; // una cita que solo está en Koibox

export type SlotWarning = "outside_shift" | "time_off" | "block";

export type SlotCheck = { clash: SlotClash | null; warnings: SlotWarning[] };

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;
const sameInterval = (a: Interval, b: Interval) =>
  a.start.getTime() === b.start.getTime() && a.end.getTime() === b.end.getTime();

// Los turnos seguidos (9–12 y 12–14) cuentan como uno: una cita puede cruzar de uno al otro
function insideShifts(slot: Interval, shifts: Interval[]): boolean {
  const sorted = [...shifts].sort((a, b) => a.start.getTime() - b.start.getTime());
  let current: Interval | null = null;
  for (const s of sorted) {
    if (current && s.start <= current.end) {
      current = { start: current.start, end: new Date(Math.max(current.end.getTime(), s.end.getTime())) };
      continue;
    }
    if (current && current.start <= slot.start && slot.end <= current.end) return true;
    current = { start: s.start, end: s.end };
  }
  return current !== null && current.start <= slot.start && slot.end <= current.end;
}

export function checkSlot(input: {
  slot: Interval;
  shifts: Interval[];
  timeOff: Interval[];
  blocks: Interval[];
  koiboxBusy: Interval[]; // lo ocupado en Koibox (también nuestras citas ya apuntadas allí)
  appointments: SlotAppointment[]; // nuestras citas que ocupan, sin la que se está moviendo
  ignore?: Interval; // al mover: la hora de antes, que en Koibox aún sale ocupada
}): SlotCheck {
  const ours = input.appointments.find((a) => overlaps(input.slot, { start: a.startsAt, end: a.endsAt }));
  let clash: SlotClash | null = ours ? { kind: "appointment", appointment: ours } : null;
  if (!clash) {
    const external = input.koiboxBusy.find(
      (b) => overlaps(input.slot, b) && !(input.ignore && sameInterval(b, input.ignore)),
    );
    if (external) clash = { kind: "koibox", startsAt: external.start, endsAt: external.end };
  }

  const warnings: SlotWarning[] = [];
  if (!insideShifts(input.slot, input.shifts)) warnings.push("outside_shift");
  if (input.timeOff.some((t) => overlaps(input.slot, t))) warnings.push("time_off");
  if (input.blocks.some((b) => overlaps(input.slot, b))) warnings.push("block");

  return { clash, warnings };
}
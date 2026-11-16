// Huecos libres de una profesional un día, como los pinta la agenda: dentro de su turno, sin
// ausencias ni bloqueos, sin sus citas (ni las que solo están en Koibox) y sin lo que ya pasó.
// Para «Mover cita»: la cita que se mueve no cuenta (su hueco queda libre).
// En modo Koibox usa la misma caché que la agenda: no gasta llamadas frescas.
import type { Interval } from "./availability";
import { loadAgendaColumns } from "./agenda-db";
import { loadAgendaKoibox } from "./agenda-koibox";
import { daySummary, openGaps, subtractIntervals, weekOf } from "./agenda-layout";
import { listAppointments } from "./appointment-list";
import type { SalonConfig } from "./salon-config";
import { dayRange } from "./working-hours";

export async function freeGapsFor(
  config: SalonConfig,
  q: { staffId: number; date: string; ignoreAppointmentId?: number; now: Date },
): Promise<Interval[]> {
  const zone = config.timezone;
  const day = dayRange(q.date, zone);
  const { koibox } = await loadAgendaKoibox(config, weekOf(q.date));

  const [columns, rows] = await Promise.all([
    loadAgendaColumns({ date: q.date, zone, all: true, withAppointments: [q.staffId], koibox }),
    listAppointments({
      statuses: ["booked", "pending_deposit", "completed", "no_show"],
      from: day.start,
      to: day.end,
      staffId: q.staffId,
      order: "asc",
      limit: 200,
    }),
  ]);
  const column = columns.find((c) => c.staffId === q.staffId);
  if (!column) return [];

  const all = rows.map((r) => ({ start: r.startsAt, end: r.endsAt }));
  const ours = rows.filter((r) => r.id !== q.ignoreAppointmentId).map((r) => ({ start: r.startsAt, end: r.endsAt }));
  // Lo ocupado en Koibox que no es nuestro (la cita que se mueve también está allí: se quita)
  const koiboxOnly = subtractIntervals(column.koiboxBusy, all);
  return openGaps(daySummary(column, [...ours, ...koiboxOnly]).free, q.now);
}
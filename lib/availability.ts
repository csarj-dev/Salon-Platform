export type Interval = { start: Date; end: Date };

export type SlotParams = {
  workingHours: Interval[]; // turnos del día, ya convertidos a instantes
  busy: Interval[];         // citas no canceladas + bloqueos
  durationMin: number;
  stepMin: number;
  bufferMin: number;
  now: Date;
  minNoticeHours: number;
};

const MIN = 60_000;

// Resta de un turno los tramos ocupados y devuelve los tramos libres
function subtract(shift: Interval, busy: Interval[]): Interval[] {
  const sorted = [...busy].sort((a, b) => a.start.getTime() - b.start.getTime());
  const free: Interval[] = [];
  let cursor = shift.start.getTime();

  for (const b of sorted) {
    const bs = b.start.getTime();
    const be = b.end.getTime();
    if (be <= cursor) continue;           // termina antes de lo que miramos
    if (bs >= shift.end.getTime()) break; // empieza después del turno
    if (bs > cursor) free.push({ start: new Date(cursor), end: new Date(bs) });
    cursor = Math.max(cursor, be);
  }

  if (cursor < shift.end.getTime()) {
    free.push({ start: new Date(cursor), end: shift.end });
  }
  return free;
}

export function getAvailableSlots(p: SlotParams): Date[] {
  const stepMs = p.stepMin * MIN;
  const durationMs = p.durationMin * MIN;
  const bufferMs = p.bufferMin * MIN;
  const earliest = p.now.getTime() + p.minNoticeHours * 60 * MIN;

  // 1. El margen se aplica a ambos lados de lo ocupado:
  //    después (preparación de la cita existente) y antes (preparación del servicio nuevo)
  const busy = p.busy.map((b) => ({
    start: new Date(b.start.getTime() - bufferMs),
    end: new Date(b.end.getTime() + bufferMs),
  }));

  const slots: Date[] = [];

  for (const shift of p.workingHours) {
    // 2. Tramos libres de este turno
    for (const free of subtract(shift, busy)) {
      // 3. Inicios alineados al reloj (:00, :30...) donde el servicio cabe entero
      let t = Math.ceil(free.start.getTime() / stepMs) * stepMs;
      while (t + durationMs <= free.end.getTime()) {
        // 4. Antelación mínima
        if (t >= earliest) slots.push(new Date(t));
        t += stepMs;
      }
    }
  }
  return slots;
}
// Reglas del recordatorio de cita. Lógica pura: no toca la base de datos ni la red.

// Cuántas horas antes de la cita se avisa
export const REMINDER_LEAD_HOURS = 24;
// Si la cita empieza en menos de este tiempo, ya no tiene sentido avisar
export const REMINDER_MIN_LEAD_MINUTES = 60;
// Intentos máximos si el envío falla (para no insistir toda la tarde con un correo roto)
export const REMINDER_MAX_ATTEMPTS = 3;

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

export type ReminderCandidate = {
  status: string;
  startsAt: Date;
  // Cuándo quedó confirmada: al pagar el depósito, o al reservar si no lleva depósito
  confirmedAt: Date;
  hasEmail: boolean;
};

// Ventana de citas que pueden necesitar recordatorio ahora: (from, to]
export function reminderWindow(now: Date): { from: Date; to: Date } {
  return {
    from: new Date(now.getTime() + REMINDER_MIN_LEAD_MINUTES * MINUTE_MS),
    to: new Date(now.getTime() + REMINDER_LEAD_HOURS * HOUR_MS),
  };
}

// ¿Toca mandar el recordatorio ahora? (no mira si ya se envió: eso lo decide la base de datos)
export function isReminderDue(c: ReminderCandidate, now: Date): boolean {
  if (c.status !== "booked" || !c.hasEmail) return false;

  const { from, to } = reminderWindow(now);
  if (c.startsAt.getTime() <= from.getTime() || c.startsAt.getTime() > to.getTime()) return false;

  // Confirmada dentro de las últimas 24 h antes de la cita: la clienta acaba de recibir
  // la confirmación, el recordatorio sería otro correo seguido con la misma información
  const leadStart = c.startsAt.getTime() - REMINDER_LEAD_HOURS * HOUR_MS;
  return c.confirmedAt.getTime() <= leadStart;
}
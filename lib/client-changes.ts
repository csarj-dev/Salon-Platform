// Qué puede hacer la clienta con su cita desde la página de la cita (el enlace del correo).
// Lógica pura. Al guardar manda lib/appointment-changes.ts; aquí se usan las mismas reglas
// para decidir qué botones y textos se enseñan:
//   - Cancelar: cita confirmada fuera del plazo, o cita que aún espera el depósito (siempre).
//   - Cambiar de hora: solo cita confirmada, fuera del plazo.
import type { SalonConfig } from "./salon-config";

// "off": el salón no lo permite (config); "not_applicable": no aplica a ese estado de la cita
export type ClientChange = "allowed" | "too_late" | "off" | "not_applicable";

export type ClientChangeState = {
  cancel: ClientChange;
  reschedule: ClientChange;
  deadline: Date; // hasta cuándo se puede (después, "too_late")
};

type Config = { booking: Pick<SalonConfig["booking"], "cancellationNoticeHours" | "clientChanges"> };

export function clientChangeState(
  appt: { status: string; startsAt: Date },
  config: Config,
  now: Date,
): ClientChangeState {
  const { cancellationNoticeHours, clientChanges } = config.booking;
  const deadline = new Date(appt.startsAt.getTime() - cancellationNoticeHours * 3_600_000);
  // Igual que withinNoticeWindow de appointment-changes: a tiempo si faltan al menos esas horas
  const inTime = now.getTime() <= deadline.getTime();

  const rule = (enabled: boolean, applies: boolean, needsTime: boolean): ClientChange =>
    !applies ? "not_applicable" : !enabled ? "off" : needsTime && !inTime ? "too_late" : "allowed";

  const booked = appt.status === "booked";
  const pending = appt.status === "pending_deposit";
  return {
    cancel: rule(clientChanges.cancel, booked || pending, booked),
    reschedule: rule(clientChanges.reschedule, booked, true),
    deadline,
  };
}
const HOUR_MS = 3_600_000;

// Hasta cuándo se guarda el hueco esperando el depósito: `holdHours` desde ahora,
// pero nunca más tarde del inicio de la cita (no tiene sentido pagar cuando ya ha empezado).
export function depositDueAt(now: Date, startsAt: Date, holdHours: number): Date {
  const limit = now.getTime() + holdHours * HOUR_MS;
  return new Date(Math.min(limit, startsAt.getTime()));
}

// Una cita pendiente de depósito cuyo plazo ya venció ya no ocupa el hueco
export function isDepositOverdue(
  appointment: { status: string; depositDueAt: Date | null },
  now: Date,
): boolean {
  return (
    appointment.status === "pending_deposit" &&
    appointment.depositDueAt !== null &&
    appointment.depositDueAt.getTime() <= now.getTime()
  );
}

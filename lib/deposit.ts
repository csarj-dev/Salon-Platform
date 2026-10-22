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

// Cómo se paga el depósito, según lo que elija el salón:
// - "instructions": la clienta ve las instrucciones (Bizum, transferencia...) y manda el comprobante
// - "whatsapp": al reservar pasa a WhatsApp a pedir el enlace de cobro, y el salón lo valida al recibir el pago
export const DEPOSIT_MODES = ["instructions", "whatsapp"] as const;
export type DepositMode = (typeof DEPOSIT_MODES)[number];

// ¿Hay que mandar a la clienta a WhatsApp a pedir el enlace de pago?
// Solo si el salón usa ese modo y la cita está esperando el depósito.
export function paysThroughWhatsApp(mode: DepositMode, status: string): boolean {
  return mode === "whatsapp" && status === "pending_deposit";
}
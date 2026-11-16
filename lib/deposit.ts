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

// Depósito de una cita con varios servicios. El salón pide un depósito fijo por categoría:
// si todos son de la misma (p. ej. cejas) se pide uno; si son de categorías distintas, se suman.
// Dentro de una categoría se toma el mayor (normalmente todos sus servicios piden lo mismo).
// Un servicio sin categoría cuenta como una categoría propia. null = no hace falta depósito.
export function depositForServices(
  services: { categoryId: number | null; depositCents: number | null }[],
): number | null {
  const byGroup = new Map<string, number>();
  services.forEach((s, i) => {
    if (s.depositCents === null) return;
    const key = s.categoryId === null ? `service:${i}` : `category:${s.categoryId}`;
    byGroup.set(key, Math.max(byGroup.get(key) ?? 0, s.depositCents));
  });
  if (byGroup.size === 0) return null;
  let total = 0;
  for (const cents of byGroup.values()) total += cents;
  return total;
}
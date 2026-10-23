// Qué correo se reenvía desde el panel según el estado de la cita.
// Pendiente de depósito, caducada, hecha o ausente: no hay nada que reenviar.
export function resendKind(status: string): "confirmation" | "cancellation" | null {
  if (status === "booked") return "confirmation";
  if (status === "cancelled") return "cancellation";
  return null;
}
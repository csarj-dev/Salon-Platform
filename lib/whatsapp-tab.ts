import type { DepositMode } from "./deposit";

// Ordenador: ratón (puntero fino) y pantalla ancha. En móvil y tablet táctil no se cumple,
// y allí se sigue saltando a WhatsApp en la misma pestaña (abre la app directamente).
export const DESKTOP_QUERY = "(pointer: fine) and (min-width: 1024px)";

// ¿Al reservar este servicio la clienta acabará en WhatsApp para pagar el depósito?
// Hay que saberlo ANTES de enviar el formulario: la pestaña nueva solo se puede abrir en el clic.
export function needsWhatsAppTab(input: {
  mode: DepositMode;
  whatsapp: string | null | undefined;
  depositCents: number | null | undefined;
}): boolean {
  return input.mode === "whatsapp" && Boolean(input.whatsapp) && Boolean(input.depositCents);
}
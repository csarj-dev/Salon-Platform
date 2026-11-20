// Pago del depósito con tarjeta desde la web: adónde vuelve la clienta y qué pasa al cobrar.
// La parte de base de datos está en lib/payments-db.ts; la de Redsys, en lib/redsys/.
import { after } from "next/server";
import { sendAppointmentEmail } from "./email/appointment-email";
import { syncKoiboxChange } from "./koibox-sync";
import { appUrl } from "./app-url";
import { startDepositPayment, type NotificationResult, type StartPaymentResult } from "./payments-db";
import type { SalonConfig } from "./salon-config";

// Ruta a la que vuelve la clienta desde la página de pago (app/api/payments/redsys/return)
export const REDSYS_RETURN_PATH = "/api/payments/redsys/return";

// Dirección de vuelta: lleva el token de la cita, el idioma y si Redsys la manda por "pagado" o no
export function redsysReturnUrl(
  token: string,
  locale: string,
  result: "ok" | "ko",
  env: Record<string, string | undefined> = process.env,
): string {
  const query = new URLSearchParams({ t: token, lang: locale, r: result });
  return `${appUrl(env)}${REDSYS_RETURN_PATH}?${query}`;
}

// Empieza el pago del depósito de una cita web y devuelve el formulario para ir a Redsys
export function startCardPayment(
  appointmentId: number,
  token: string,
  locale: string,
  config: SalonConfig,
  description: string,
): Promise<StartPaymentResult> {
  return startDepositPayment(
    appointmentId,
    {
      okUrl: redsysReturnUrl(token, locale, "ok"),
      koUrl: redsysReturnUrl(token, locale, "ko"),
      locale,
      description,
    },
    config,
  );
}

// Lo que pasa después de aplicar un aviso de Redsys (venga del aviso o de la vuelta de la clienta):
// si la cita queda confirmada, correo a la clienta y etiqueta en Koibox, después de responder.
// Si el aviso ya se había aplicado (duplicate), no se repite nada.
export function runPaymentEffects(result: NotificationResult, config: SalonConfig): void {
  if (!result.ok) return;
  if (result.outcome === "paid") {
    after(() => sendAppointmentEmail(result.appointmentId, "confirmation"));
    after(() => syncKoiboxChange(result.appointmentId, { kind: "deposit_paid" }, config));
  } else if (result.outcome === "paid_late") {
    console.error(
      `[redsys] pago ${result.paymentId} cobrado pero la cita ${result.appointmentId} ya no esperaba el depósito: revisar`,
    );
  }
}
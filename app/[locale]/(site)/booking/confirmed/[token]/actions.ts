"use server";

import { after } from "next/server";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { cancelAppointment, toChangeOptions } from "@/lib/appointment-changes";
import { startCardPayment } from "@/lib/card-payment";
import { collectorForAppointment } from "@/lib/collectors-db";
import type { PaymentForm } from "@/lib/redsys/gateway";
import { moveAppointment, type MoveResult } from "@/lib/move-appointment";
import { findAppointmentIdByToken } from "@/lib/appointment-view";
import { sendAppointmentEmail } from "@/lib/email/appointment-email";
import { syncKoiboxChange } from "@/lib/koibox-sync";
import { loadSalonConfig } from "@/lib/salon-config";

export type ClientCancelResult =
  | { ok: true }
  | { ok: false; error: "notFound" | "disabled" | "tooLate" | "notChangeable" | "server" };

// La clienta cancela su cita desde su enlace. No hay sesión: el permiso es el token secreto
// de la cita. Las reglas (estado y plazo) las aplica cancelAppointment, no el navegador.
export async function cancelByClientAction(token: string): Promise<ClientCancelResult> {
  const config = await loadSalonConfig();
  if (!config.booking.channels.includes("online") || !config.booking.clientChanges.cancel) {
    return { ok: false, error: "disabled" };
  }
  const id = await findAppointmentIdByToken(token);
  if (id === null) return { ok: false, error: "notFound" };

  try {
    const result = await cancelAppointment(id, toChangeOptions(config), "client", new Date());
    if (!result.ok) {
      const error =
        result.reason === "too_late" ? "tooLate" : result.reason === "not_found" ? "notFound" : "notChangeable";
      return { ok: false, error };
    }
  } catch (error) {
    console.error("[booking] cancelar desde la web", error);
    return { ok: false, error: "server" };
  }

  // Después de responder: el correo de cancelación y anularla en Koibox (si el salón lo usa;
  // si falla, queda pendiente y lo recoge el reintento)
  after(() => sendAppointmentEmail(id, "cancellation"));
  after(() => syncKoiboxChange(id, { kind: "cancelled_by_client" }, config));
  return { ok: true };
}

export type ClientRescheduleError =
  | "notFound" | "disabled" | "invalid" | "tooLate" | "notChangeable"
  | "slotUnavailable" | "slotTaken" | "koiboxUnavailable" | "server";
export type ClientRescheduleResult = { ok: true } | { ok: false; error: ClientRescheduleError };

const MOVE_ERRORS: Record<Extract<MoveResult, { ok: false }>["reason"], ClientRescheduleError> = {
  not_found: "notFound",
  not_changeable: "notChangeable",
  too_late: "tooLate",
  slot_unavailable: "slotUnavailable",
  slot_taken: "slotTaken",
  koibox_unavailable: "koiboxUnavailable",
};

// La clienta cambia su cita de día u hora desde su enlace (misma profesional, servicio y local).
// El permiso es el token secreto; las reglas (plazo, hueco libre, Koibox) las aplica moveAppointment.
export async function rescheduleByClientAction(token: string, at: string): Promise<ClientRescheduleResult> {
  const config = await loadSalonConfig();
  if (!config.booking.channels.includes("online") || !config.booking.clientChanges.reschedule) {
    return { ok: false, error: "disabled" };
  }
  const newStartsAt = typeof at === "string" ? new Date(at) : new Date(Number.NaN);
  if (Number.isNaN(newStartsAt.getTime())) return { ok: false, error: "invalid" };
  const id = await findAppointmentIdByToken(token);
  if (id === null) return { ok: false, error: "notFound" };

  try {
    const result = await moveAppointment(id, newStartsAt, config, { actor: "client" });
    if (!result.ok) return { ok: false, error: MOVE_ERRORS[result.reason] };
  } catch (error) {
    console.error("[booking] cambiar de hora desde la web", error);
    return { ok: false, error: "server" };
  }

  // Koibox ya está hecho dentro de moveAppointment; el correo, después de responder
  after(() => sendAppointmentEmail(id, "rescheduled"));
  return { ok: true };
}


export type RetryPaymentResult =
  | { ok: true; form: PaymentForm }
  | { ok: false; error: "notFound" | "notPending" | "server" };

// La clienta vuelve a intentar pagar el depósito con tarjeta desde su enlace (después de un pago
// que no salió, o si cerró la página de pago). Cada intento es un pedido nuevo de Redsys.
export async function retryCardPaymentAction(token: string, locale: string): Promise<RetryPaymentResult> {
  if (!hasLocale(routing.locales, locale)) return { ok: false, error: "server" };
  const id = await findAppointmentIdByToken(token);
  if (id === null) return { ok: false, error: "notFound" };

  try {
    const config = await loadSalonConfig();
    const collector = await collectorForAppointment(id, config);
    if (collector.deposit.mode !== "card") return { ok: false, error: "notPending" };
    const tb = await getTranslations({ locale, namespace: "Booking" });
    const result = await startCardPayment(id, token.toLowerCase(), locale, config, tb("payDescription"));
    if (result.ok) return { ok: true, form: result.form };
    if (result.reason === "not_found") return { ok: false, error: "notFound" };
    if (result.reason === "not_pending" || result.reason === "expired") return { ok: false, error: "notPending" };
    console.error(`[booking] no se pudo volver a abrir el pago de la cita ${id}: ${result.reason}`);
    return { ok: false, error: "server" };
  } catch (error) {
    console.error("[booking] volver a pagar", error);
    return { ok: false, error: "server" };
  }
}
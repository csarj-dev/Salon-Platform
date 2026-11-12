"use server";

import { after } from "next/server";
import { cancelAppointment, toChangeOptions } from "@/lib/appointment-changes";
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
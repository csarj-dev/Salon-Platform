"use server";

import { after } from "next/server";
import { cancelAppointment, toChangeOptions } from "@/lib/appointment-changes";
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
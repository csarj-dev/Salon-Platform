"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { cancelAppointment, toChangeOptions } from "@/lib/appointment-changes";
import { markDepositPaid } from "@/lib/deposit-db";
import { loadSalonConfig } from "@/lib/salon-config";
import { requireStaff } from "@/lib/session";
import { sendAppointmentEmail } from "@/lib/email/appointment-email";

export type StaffActionResult =
  | { ok: true }
  | { ok: false; error: "invalid" | "notFound" | "notPending" | "notChangeable" | "expired" | "server" };

const idSchema = z.number().int().positive();
const reasonSchema = z.string().trim().max(300).optional();

function refresh(locale: string) {
  revalidatePath(`/${locale}/admin/deposits`);
  revalidatePath(`/${locale}/admin/appointments`);
}

// Recepción confirma que recibió el depósito. Queda guardado quién lo validó.
export async function validateDepositAction(appointmentId: number): Promise<StaffActionResult> {
  const locale = await getLocale();
  const { user } = await requireStaff(locale, "deposits.manage");
  if (!idSchema.safeParse(appointmentId).success) return { ok: false, error: "invalid" };

  try {
    const result = await markDepositPaid(appointmentId, new Date(), user.id);
    if (!result.ok) {
      const error =
        result.reason === "not_found"
          ? "notFound"
          : result.reason === "expired"
            ? "expired"
            : "notPending";
      return { ok: false, error };
    }
  } catch (error) {
    console.error("[appointments] validate", error);
    return { ok: false, error: "server" };
  }
  // La cita queda confirmada: se avisa a la clienta por correo después de responder
  after(() => sendAppointmentEmail(appointmentId, "confirmation"));
  refresh(locale);
  return { ok: true };
}

// El equipo cancela una cita (sin plazo mínimo). Queda quién, cuándo y el motivo opcional.
export async function cancelAppointmentAction(
  appointmentId: number,
  reason?: string,
): Promise<StaffActionResult> {
  const locale = await getLocale();
  const { user } = await requireStaff(locale, "appointments.manage");
  const parsedReason = reasonSchema.safeParse(reason);
  if (!idSchema.safeParse(appointmentId).success || !parsedReason.success) {
    return { ok: false, error: "invalid" };
  }

  try {
    const config = await loadSalonConfig();
    const result = await cancelAppointment(
      appointmentId,
      toChangeOptions(config),
      "staff",
      new Date(),
      { userId: user.id, reason: parsedReason.data },
    );
    if (!result.ok) {
      return { ok: false, error: result.reason === "not_found" ? "notFound" : "notChangeable" };
    }
  } catch (error) {
    console.error("[appointments] cancel", error);
    return { ok: false, error: "server" };
  }
  after(() => sendAppointmentEmail(appointmentId, "cancellation"));
  refresh(locale);
  return { ok: true };
}
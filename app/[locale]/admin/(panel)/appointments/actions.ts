"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appointment } from "@/db/schema";
import { freeGapsFor } from "@/lib/agenda-gaps";
import { resendKind } from "@/lib/email/resend-kind";
import { cancelAppointment, toChangeOptions } from "@/lib/appointment-changes";
import { keepDepositAtTill, toSavedDepositOptions } from "@/lib/deposit-credits";
import { markDepositPaid } from "@/lib/deposit-db";
import { refundPayment } from "@/lib/payments-db";
import {
  pushNewWebBooking, retryKoiboxSync, syncKoiboxChange, syncPendingKoibox, writesToKoibox,
} from "@/lib/koibox-sync";
import {
  createStaffAppointment, findClientByPhone, type ClientLookup, type StaffBookingResult,
} from "@/lib/staff-booking";
import { loadSalonConfig } from "@/lib/salon-config";
import { requireStaff } from "@/lib/session";
import { sendAppointmentEmail } from "@/lib/email/appointment-email";
import {
  moveStaffAppointment, previewStaffMove, type StaffMovePreview, type StaffMoveResult,
} from "@/lib/move-appointment";

export type StaffActionResult =
  | { ok: true }
  | { ok: false; error: "invalid" | "notFound" | "notPending" | "notChangeable" | "expired" | "server" };

const idSchema = z.number().int().positive();
const reasonSchema = z.string().trim().max(300).optional();

function refresh(locale: string) {
  revalidatePath(`/${locale}/admin/deposits`);
  revalidatePath(`/${locale}/admin/appointments`, "layout"); // la Agenda y la Lista (/list)
  revalidatePath(`/${locale}/admin/koibox`); // la pestaña "Pendiente" de Koibox
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
  // La cita queda confirmada: se avisa a la clienta por correo y se cambia la etiqueta
  // en Koibox, las dos cosas después de responder
  after(() => sendAppointmentEmail(appointmentId, "confirmation"));
  after(async () => syncKoiboxChange(appointmentId, { kind: "deposit_paid" }, await loadSalonConfig()));
  refresh(locale);
  return { ok: true };
}

// El equipo cancela una cita (sin plazo mínimo). Queda quién, cuándo y el motivo opcional.
// keepDeposit: guardarle el depósito pagado para otra cita (si el salón usa depósitos guardados).
export async function cancelAppointmentAction(
  appointmentId: number,
  reason?: string,
  keepDeposit = false,
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
      { userId: user.id, reason: parsedReason.data, keepDeposit: keepDeposit === true },
    );
    if (!result.ok) {
      return { ok: false, error: result.reason === "not_found" ? "notFound" : "notChangeable" };
    }
  } catch (error) {
    console.error("[appointments] cancel", error);
    return { ok: false, error: "server" };
  }
  after(() => sendAppointmentEmail(appointmentId, "cancellation"));
  after(async () =>
    syncKoiboxChange(
      appointmentId,
      { kind: "cancelled_by_staff", reason: parsedReason.data },
      await loadSalonConfig(),
    ),
  );
  refresh(locale);
  return { ok: true };
}

export type RefundActionResult =
  | { ok: true }
  | {
      ok: false;
      error: "invalid" | "notPaid" | "noKey" | "refundUnreachable" | "refundRejected" | "depositSaved" | "server";
      detail?: string;
    };

// Dirección o administración devuelve entero un pago con tarjeta. Solo queda como devuelto si
// Redsys lo confirma. La cita no se toca: si además hay que cancelarla, es otro botón.
export async function refundPaymentAction(paymentId: number): Promise<RefundActionResult> {
  const locale = await getLocale();
  const { user } = await requireStaff(locale, "payments.refund");
  if (!idSchema.safeParse(paymentId).success) return { ok: false, error: "invalid" };

  try {
    const result = await refundPayment(paymentId, await loadSalonConfig(), { refundedBy: user.id });
    if (!result.ok) {
      const error =
        result.reason === "not_found" || result.reason === "not_paid"
          ? "notPaid"
          : result.reason === "deposit_saved"
            ? "depositSaved"
          : result.reason === "no_key"
            ? "noKey"
            : result.reason === "unreachable"
              ? "refundUnreachable"
              : "refundRejected";
      return { ok: false, error, detail: result.detail };
    }
  } catch (error) {
    console.error("[appointments] refund", error);
    return { ok: false, error: "server" };
  }
  refresh(locale);
  return { ok: true };
}

export type KeepDepositResult =
  | { ok: true }
  | { ok: false; error: "invalid" | "notFound" | "notStarted" | "notEligible" | "alreadySaved" | "server" };

// La clienta paga en caja el servicio entero: se le guarda el depósito que ya pagó y se le avisa
// por correo. La cita no cambia (el cobro en sí se hace en Koibox).
export async function keepDepositAtTillAction(appointmentId: number): Promise<KeepDepositResult> {
  const locale = await getLocale();
  const { user } = await requireStaff(locale, "deposits.manage");
  if (!idSchema.safeParse(appointmentId).success) return { ok: false, error: "invalid" };

  try {
    const config = await loadSalonConfig();
    const result = await keepDepositAtTill(appointmentId, toSavedDepositOptions(config), user.id);
    if (!result.ok) {
      const error = (
        {
          disabled: "notEligible",
          not_found: "notFound",
          not_started: "notStarted",
          not_eligible: "notEligible",
          already_saved: "alreadySaved",
        } as const
      )[result.reason];
      return { ok: false, error };
    }
  } catch (error) {
    console.error("[appointments] keep deposit at till", error);
    return { ok: false, error: "server" };
  }
  after(() => sendAppointmentEmail(appointmentId, "deposit_saved"));
  refresh(locale);
  return { ok: true };
}

export type ResendResult =
  | { ok: true }
  | { ok: false; error: "invalid" | "notFound" | "notResendable" | "noEmail" | "sendFailed" };

// Reenvía el correo que corresponde al estado de la cita (confirmación o cancelación).
// Se espera a que termine para decirle a quien lo pulsa si salió bien.
export async function resendEmailAction(appointmentId: number): Promise<ResendResult> {
  const locale = await getLocale();
  await requireStaff(locale, "appointments.manage");
  if (!idSchema.safeParse(appointmentId).success) return { ok: false, error: "invalid" };

  const [row] = await db
    .select({ status: appointment.status })
    .from(appointment)
    .where(eq(appointment.id, appointmentId));
  if (!row) return { ok: false, error: "notFound" };

  const kind = resendKind(row.status);
  if (!kind) return { ok: false, error: "notResendable" };

  const outcome = await sendAppointmentEmail(appointmentId, kind);
  refresh(locale);
  if (outcome.ok) return { ok: true };
  if (outcome.reason === "not_found") return { ok: false, error: "notFound" };
  if (outcome.reason === "no_email") return { ok: false, error: "noEmail" };
  return { ok: false, error: "sendFailed" };
}

export type KoiboxRetryResult =
  | { ok: true; done: boolean }
  | { ok: false; error: "invalid" | "disabled" | "notFound" | "server" }
  | { ok: false; error: "koibox"; message: string };

// Botón "Reintentar" de una cita: lo que haga falta en Koibox, decidido en el servidor
export async function retryKoiboxAction(appointmentId: number): Promise<KoiboxRetryResult> {
  const locale = await getLocale();
  await requireStaff(locale, "appointments.manage");
  if (!idSchema.safeParse(appointmentId).success) return { ok: false, error: "invalid" };

  const config = await loadSalonConfig();
  if (!writesToKoibox(config)) return { ok: false, error: "disabled" };

  try {
    const result = await retryKoiboxSync(appointmentId, config);
    if (result === null) return { ok: false, error: "notFound" };
    refresh(locale);
    return result.ok ? result : { ok: false, error: "koibox", message: result.message };
  } catch (error) {
    console.error("[appointments] reintentar Koibox", error);
    return { ok: false, error: "server" };
  }
}

export type KoiboxRetryAllResult =
  | { ok: true; checked: number; fixed: number; failed: number; expired: number }
  | { ok: false; error: "disabled" | "server" };

// "Reintentar todo": lo mismo que hace el reintento automático cada 15 minutos
export async function retryAllKoiboxAction(): Promise<KoiboxRetryAllResult> {
  const locale = await getLocale();
  await requireStaff(locale, "appointments.manage");
  const config = await loadSalonConfig();
  if (!writesToKoibox(config)) return { ok: false, error: "disabled" };

  try {
    const s = await syncPendingKoibox(config);
    refresh(locale);
    if ("disabled" in s && s.disabled) return { ok: false, error: "disabled" };
    return { ok: true, checked: s.checked, fixed: s.fixed, failed: s.failed.length, expired: s.expired };
  } catch (error) {
    console.error("[appointments] reintentar todo Koibox", error);
    return { ok: false, error: "server" };
  }
}

// ---- Crear citas desde recepción ----

export type CreateStaffAppointmentResult =
  | (Extract<StaffBookingResult, { ok: true }> & { koibox: "synced" | "pending" | "none" })
  | Extract<StaffBookingResult, { ok: false }>
  // Koibox no la aceptó: la nuestra queda anulada (como en la web) y recepción elige otra hora
  | { ok: false; reason: "koibox_rejected" | "server" };

// Recepción crea una cita (varios servicios, duración propia, depósito a elegir).
// `sendEmail`: mandarle la confirmación (solo si queda confirmada; con enlace de pago,
// el correo sale al validar el depósito, como en la web).
export async function createStaffAppointmentAction(
  input: unknown,
  sendEmail = true,
): Promise<CreateStaffAppointmentResult> {
  const locale = await getLocale();
  const { user } = await requireStaff(locale, "appointments.manage");

  try {
    const config = await loadSalonConfig();
    const result = await createStaffAppointment(input, config, { userId: user.id });
    if (!result.ok) return result;

    // Con Koibox, apuntarla allí antes de dar la cita por buena
    let koibox: "synced" | "pending" | "none" = "none";
    if (writesToKoibox(config)) {
      const pushed = await pushNewWebBooking(result.appointmentId, config);
      if (!pushed.ok) {
        refresh(locale);
        return { ok: false, reason: pushed.reason === "slot_taken" ? "slot_taken" : "koibox_rejected" };
      }
      koibox = pushed.synced ? "synced" : "pending";
    }

    if (sendEmail && result.status === "booked") {
      const appointmentId = result.appointmentId;
      after(() => sendAppointmentEmail(appointmentId, "confirmation"));
    }
    refresh(locale);
    return { ...result, koibox };
  } catch (error) {
    console.error("[appointments] create from panel", error);
    return { ok: false, reason: "server" };
  }
}

// Al escribir el teléfono en «Nueva cita»: ¿ya es clienta?
export async function findClientByPhoneAction(phone: string): Promise<ClientLookup> {
  const locale = await getLocale();
  await requireStaff(locale, "appointments.manage");
  if (typeof phone !== "string") return null;
  return findClientByPhone(phone);
}

// ---- Mover una cita desde el panel (arrastrar, estirar o el formulario «Mover cita») ----

export type MoveStaffAppointmentResult = StaffMoveResult | { ok: false; reason: "server" };

// Recepción cambia la hora, la profesional y/o la duración. `notify`: mandarle a la clienta
// «Tu cita ha cambiado» (la casilla «Avisar a la clienta», marcada por defecto).
export async function moveStaffAppointmentAction(
  appointmentId: number,
  change: unknown,
  notify = true,
): Promise<MoveStaffAppointmentResult> {
  const locale = await getLocale();
  await requireStaff(locale, "appointments.manage");
  if (!idSchema.safeParse(appointmentId).success) {
    return { ok: false, reason: "invalid_input", issues: ["appointmentId"] };
  }

  let result: StaffMoveResult;
  try {
    result = await moveStaffAppointment(appointmentId, change, await loadSalonConfig());
  } catch (error) {
    console.error("[appointments] move from panel", error);
    return { ok: false, reason: "server" };
  }
  if (!result.ok) return result;

  // Koibox ya está hecho dentro; el correo, después de responder
  if (notify) after(() => sendAppointmentEmail(appointmentId, "rescheduled"));
  refresh(locale);
  return result;
}

export type CheckStaffMoveResult = StaffMovePreview | { ok: false; reason: "server" };

// «¿Mover la cita?»: comprueba el cambio sin hacerlo (avisos, choques, cambio de cuenta de Koibox)
export async function checkStaffMoveAction(appointmentId: number, change: unknown): Promise<CheckStaffMoveResult> {
  const locale = await getLocale();
  await requireStaff(locale, "appointments.manage");
  if (!idSchema.safeParse(appointmentId).success) {
    return { ok: false, reason: "invalid_input", issues: ["appointmentId"] };
  }
  try {
    return await previewStaffMove(appointmentId, change, await loadSalonConfig());
  } catch (error) {
    console.error("[appointments] check move from panel", error);
    return { ok: false, reason: "server" };
  }
}

// «Mover cita»: huecos libres de una profesional ese día, sin contar la cita que se mueve
export async function freeGapsAction(
  appointmentId: number,
  staffId: number,
  date: string,
): Promise<{ start: string; end: string }[]> {
  const locale = await getLocale();
  await requireStaff(locale, "appointments.manage");
  if (
    !idSchema.safeParse(appointmentId).success ||
    !idSchema.safeParse(staffId).success ||
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
  ) {
    return [];
  }
  try {
    const gaps = await freeGapsFor(await loadSalonConfig(), {
      staffId,
      date,
      ignoreAppointmentId: appointmentId,
      now: new Date(),
    });
    return gaps.map((g) => ({ start: g.start.toISOString(), end: g.end.toISOString() }));
  } catch (error) {
    console.error("[appointments] free gaps", error);
    return [];
  }
}
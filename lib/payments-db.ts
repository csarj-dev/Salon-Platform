// Pagos con tarjeta por Redsys, con la base de datos: empezar un pago y aplicar el aviso de Redsys.
// Lo que no toca la base (firma, formulario, entorno) está en lib/redsys/.
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import { appointment, payment } from "../db/schema";
import { appUrl } from "./app-url";
import { pgErrorCode } from "./booking";
import { salonCollectors } from "./collectors";
import { collectorForAppointment } from "./collectors-db";
import { isDepositOverdue } from "./deposit";
import { hasSavedDeposit } from "./deposit-credits";
import {
  REDSYS_REST_URL, buildPaymentForm, buildRefundRequest, isAuthorized, newOrderCode, readNotification,
  readRefundReply, redsysCredentials, redsysEnvironment,
  type NotificationForm, type PaymentForm, type RedsysEnvironment,
} from "./redsys/gateway";
import { signaturesMatch, sign } from "./redsys/signature";
import type { SalonConfig } from "./salon-config";

type Env = Record<string, string | undefined>;
type PaymentsConfig = Pick<SalonConfig, "name" | "contact" | "koibox" | "payments">;

// Ruta a la que avisa Redsys (app/api/payments/redsys/notify/route.ts)
export const REDSYS_NOTIFY_PATH = "/api/payments/redsys/notify";

export type StartPaymentResult =
  | { ok: true; paymentId: number; orderCode: string; form: PaymentForm }
  | {
      ok: false;
      // not_found / not_pending / expired: la cita no está esperando el depósito
      // no_tpv / no_key: su cobrador no tiene TPV en el config, o falta la clave en el entorno
      reason: "not_found" | "not_pending" | "expired" | "no_tpv" | "no_key";
    };

export type StartPaymentInput = {
  okUrl: string; // adonde vuelve la clienta si pagó
  koUrl: string; // adonde vuelve si no pagó
  locale: string; // idioma de la página de pago
  description?: string; // lo que ve en la página de pago
};

// Empieza el pago del depósito de una cita: guarda el intento con un número de pedido nuevo y
// devuelve el formulario firmado que lleva a la clienta a la página de pago de Redsys.
export async function startDepositPayment(
  appointmentId: number,
  input: StartPaymentInput,
  config: PaymentsConfig,
  now: Date = new Date(),
  env: Env = process.env,
): Promise<StartPaymentResult> {
  const [appt] = await db
    .select({ status: appointment.status, depositCents: appointment.depositCents, depositDueAt: appointment.depositDueAt })
    .from(appointment)
    .where(eq(appointment.id, appointmentId));
  if (!appt) return { ok: false, reason: "not_found" };
  if (appt.status === "expired" || isDepositOverdue(appt, now)) return { ok: false, reason: "expired" };
  if (appt.status !== "pending_deposit" || appt.depositCents === null) return { ok: false, reason: "not_pending" };

  const collector = await collectorForAppointment(appointmentId, config);
  const creds = redsysCredentials(redsysEnvironment(env), collector.redsys, env);
  if (!creds.ok) return { ok: false, reason: creds.reason };
  const { credentials } = creds;

  // El número de pedido es aleatorio: si por casualidad ya existe, se prueba con otro
  for (let attempt = 0; ; attempt++) {
    const orderCode = newOrderCode();
    try {
      const [row] = await db
        .insert(payment)
        .values({
          appointmentId,
          collector: collector.id,
          environment: credentials.environment,
          merchantCode: credentials.merchantCode,
          terminal: credentials.terminal,
          orderCode,
          amountCents: appt.depositCents,
          createdAt: now,
        })
        .returning({ id: payment.id });
      const form = buildPaymentForm({
        credentials,
        order: orderCode,
        amountCents: appt.depositCents,
        notifyUrl: `${appUrl(env)}${REDSYS_NOTIFY_PATH}`,
        okUrl: input.okUrl,
        koUrl: input.koUrl,
        locale: input.locale,
        description: input.description,
        merchantName: config.name,
      });
      return { ok: true, paymentId: row.id, orderCode, form };
    } catch (error) {
      if (pgErrorCode(error) !== "23505" || attempt >= 2) throw error;
    }
  }
}

// Clave con la que se firmó un pago: la de pruebas de Redsys, o la del TPV de su cobrador
function keyForPayment(
  p: { environment: string; collector: string },
  config: PaymentsConfig,
  env: Env,
): string | null {
  const environment = p.environment as RedsysEnvironment;
  const tpv = salonCollectors(config).byId.get(p.collector)?.redsys ?? null;
  const creds = redsysCredentials(environment, tpv, env);
  return creds.ok ? creds.credentials.key : null;
}

export type NotificationResult =
  // paid: pagado y cita confirmada · failed: pago denegado o cancelado (la cita sigue esperando)
  // duplicate: Redsys repitió un aviso que ya se había aplicado
  // paid_late: pagado, pero la cita ya no esperaba el depósito (caducó, se anuló o ya estaba
  //            pagada por otro intento): hay que revisarlo y, si toca, devolverlo
  | { ok: true; outcome: "paid" | "failed" | "duplicate" | "paid_late"; appointmentId: number; paymentId: number }
  // invalid: el aviso no trae lo que debe · unknown_order: no es un pedido nuestro
  // bad_signature: la firma no cuadra · mismatch: importe o comercio distintos de los del pedido
  // no_key: no hay clave para comprobarlo (se quitó el TPV del config o falta la variable)
  | { ok: false; reason: "invalid" | "unknown_order" | "bad_signature" | "mismatch" | "no_key" };

// Aplica el aviso de Redsys. Comprueba la firma con la clave de ese pedido antes de tocar nada.
// Es seguro recibir el mismo aviso varias veces: solo se aplica la primera.
export async function applyRedsysNotification(
  form: NotificationForm,
  config: PaymentsConfig,
  now: Date = new Date(),
  env: Env = process.env,
): Promise<NotificationResult> {
  const notice = readNotification(form);
  if (!notice) return { ok: false, reason: "invalid" };

  const [p] = await db.select().from(payment).where(eq(payment.orderCode, notice.order));
  if (!p) return { ok: false, reason: "unknown_order" };

  const key = keyForPayment(p, config, env);
  if (!key) return { ok: false, reason: "no_key" };
  const expected = sign(form.Ds_MerchantParameters as string, notice.order, key);
  if (!signaturesMatch(form.Ds_Signature as string, expected)) return { ok: false, reason: "bad_signature" };

  if (
    notice.amountCents !== p.amountCents ||
    notice.merchantCode !== p.merchantCode ||
    notice.terminal !== p.terminal
  ) {
    return { ok: false, reason: "mismatch" };
  }

  const paid = isAuthorized(notice.responseCode);
  const base = { appointmentId: p.appointmentId, paymentId: p.id };
  return db.transaction(async (tx) => {
    // Solo pasa de "created" a su resultado una vez, aunque lleguen dos avisos a la vez
    const updated = await tx
      .update(payment)
      .set({
        status: paid ? "paid" : "failed",
        responseCode: notice.responseCode,
        authCode: notice.authCode,
        notifiedAt: now,
      })
      .where(and(eq(payment.id, p.id), eq(payment.status, "created")))
      .returning({ id: payment.id });
    if (updated.length === 0) return { ok: true, outcome: "duplicate", ...base } as const;
    if (!paid) return { ok: true, outcome: "failed", ...base } as const;

    // Igual que cuando recepción valida el depósito: si el plazo venció pero nadie liberó aún
    // el hueco, se acepta. Si ya no está pendiente, el dinero entró igual: queda para revisar.
    const confirmed = await tx
      .update(appointment)
      .set({ status: "booked", depositPaidAt: now, depositValidatedBy: null })
      .where(and(eq(appointment.id, p.appointmentId), eq(appointment.status, "pending_deposit")))
      .returning({ id: appointment.id });
    return { ok: true, outcome: confirmed.length > 0 ? "paid" : "paid_late", ...base } as const;
  });
}


// ---- Lo que ve el panel y las devoluciones ----

export type PaymentSummary = {
  id: number;
  status: "created" | "paid" | "failed" | "refunded";
  environment: string; // "test" | "live"
  orderCode: string;
  amountCents: number;
  notifiedAt: Date | null;
  refundedAt: Date | null;
};

// Pagos con tarjeta de una cita, del más antiguo al más nuevo
export async function paymentsForAppointment(appointmentId: number): Promise<PaymentSummary[]> {
  return db
    .select({
      id: payment.id,
      status: payment.status,
      environment: payment.environment,
      orderCode: payment.orderCode,
      amountCents: payment.amountCents,
      notifiedAt: payment.notifiedAt,
      refundedAt: payment.refundedAt,
    })
    .from(payment)
    .where(eq(payment.appointmentId, appointmentId))
    .orderBy(asc(payment.createdAt), asc(payment.id));
}

export type RefundResult =
  | { ok: true; appointmentId: number }
  | {
      ok: false;
      // not_found / not_paid: no hay un pago cobrado que devolver · no_key: falta la clave del TPV
      // unreachable: no se pudo hablar con Redsys · rejected / error: Redsys no la aceptó
      // bad_reply: la respuesta no se entiende o su firma no cuadra
      // deposit_saved: el depósito de esa cita se le guardó para otra cita (no se devuelve dos veces)
      reason: "not_found" | "not_paid" | "no_key" | "unreachable" | "rejected" | "error" | "bad_reply" | "deposit_saved";
      detail?: string; // código de Redsys (Ds_Response o SIS…), para el registro y el panel
    };

type RefundOptions = {
  now?: Date;
  env?: Env;
  refundedBy?: string | null; // id del usuario del equipo que la pide (auditoría)
  fetchFn?: typeof fetch; // para los tests
};

// Devuelve entero un pago cobrado con tarjeta. Solo se marca como devuelto si Redsys lo confirma
// (Ds_Response 0900, con su firma comprobada). La cita no cambia: cancelarla es otra decisión.
export async function refundPayment(
  paymentId: number,
  config: PaymentsConfig,
  opts: RefundOptions = {},
): Promise<RefundResult> {
  const now = opts.now ?? new Date();
  const env = opts.env ?? process.env;
  const fetchFn = opts.fetchFn ?? fetch;

  const [p] = await db.select().from(payment).where(eq(payment.id, paymentId));
  if (!p) return { ok: false, reason: "not_found" };
  if (p.status !== "paid") return { ok: false, reason: "not_paid" };
  if (await hasSavedDeposit(p.appointmentId)) return { ok: false, reason: "deposit_saved" };

  const key = keyForPayment(p, config, env);
  if (!key) return { ok: false, reason: "no_key" };
  const environment = p.environment as RedsysEnvironment;
  const request = buildRefundRequest(
    { environment, merchantCode: p.merchantCode, terminal: p.terminal, key },
    p.orderCode,
    p.amountCents,
  );

  let body: unknown;
  try {
    const response = await fetchFn(REDSYS_REST_URL[environment], {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(20_000),
    });
    body = await response.json();
  } catch (error) {
    console.error(`[redsys] devolución del pago ${paymentId}: sin respuesta`, error);
    return { ok: false, reason: "unreachable" };
  }

  const reply = readRefundReply(body, key);
  if (!reply.ok) {
    const detail = reply.reason === "rejected" ? String(reply.responseCode) : reply.reason === "error" ? reply.code : undefined;
    console.error(`[redsys] devolución del pago ${paymentId} no aceptada: ${reply.reason}${detail ? ` ${detail}` : ""}`);
    return { ok: false, reason: reply.reason, detail };
  }

  // Solo una vez, aunque se pulse dos veces a la vez
  const updated = await db
    .update(payment)
    .set({ status: "refunded", refundedAt: now, refundedBy: opts.refundedBy ?? null })
    .where(and(eq(payment.id, paymentId), eq(payment.status, "paid")))
    .returning({ id: payment.id });
  if (updated.length === 0) return { ok: false, reason: "not_paid" };
  return { ok: true, appointmentId: p.appointmentId };
}
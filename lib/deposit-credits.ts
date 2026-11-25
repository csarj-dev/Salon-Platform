// Depósitos guardados (booking.deposit.saved): qué se guarda al anular una cita con el depósito
// pagado o al cobrarle en caja el servicio entero, cuáles valen para una reserva nueva, y lo que
// se enseña de ellos.
import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "../db";
import { appointment, appointmentService, depositCredit, payment, service } from "../db/schema";
import { resolveCollector } from "./collectors";
import { collectorForAppointment } from "./collectors-db";
import { depositParts, type DepositPart } from "./deposit";
import type { SalonConfig } from "./salon-config";

type CollectorsConfig = Parameters<typeof resolveCollector>[0];

export type SavedDepositOptions = {
  months: number; // cuánto dura guardado
  zone: string; // zona del salón, para contar los meses
  collectors: CollectorsConfig; // para saber quién cobró si no hubo pago con tarjeta
};

export function toSavedDepositOptions(c: SalonConfig): SavedDepositOptions | undefined {
  const saved = c.booking.deposit.saved;
  return saved ? { months: saved.months, zone: c.timezone, collectors: c } : undefined;
}

// Hasta cuándo vale un depósito guardado hoy: `months` meses después, a la misma hora del salón
export function savedDepositExpiry(now: Date, months: number, zone: string): Date {
  return DateTime.fromJSDate(now, { zone }).plus({ months }).toJSDate();
}

export type NewDepositCredit = typeof depositCredit.$inferInsert;

// Lo que habría que guardar de esta cita: una fila por categoría de su depósito.
// Vacío si no hay nada que guardar: no estaba confirmada, el depósito no se pagó, se devolvió,
// o ya se guardó antes (una cita guarda su depósito una sola vez).
// Solo lee: quien lo guarda lo inserta en la misma transacción que su cambio.
export async function depositCreditsToSave(
  appointmentId: number,
  opts: SavedDepositOptions,
  now: Date,
): Promise<NewDepositCredit[]> {
  const [appt] = await db
    .select({
      clientId: appointment.clientId,
      status: appointment.status,
      serviceId: appointment.serviceId,
      depositCents: appointment.depositCents,
      depositPaidAt: appointment.depositPaidAt,
    })
    .from(appointment)
    .where(eq(appointment.id, appointmentId));
  if (!appt || (appt.status !== "booked" && appt.status !== "completed")) return [];
  if (appt.depositCents === null || appt.depositPaidAt === null) return [];
  const [already] = await db
    .select({ id: depositCredit.id })
    .from(depositCredit)
    .where(eq(depositCredit.sourceAppointmentId, appointmentId))
    .limit(1);
  if (already) return [];

  // Si se pagó con tarjeta, el dinero está en el TPV de ese cobrador; si se devolvió, no hay nada
  const payments = await db
    .select({ status: payment.status, collector: payment.collector })
    .from(payment)
    .where(eq(payment.appointmentId, appointmentId));
  const paid = payments.find((p) => p.status === "paid");
  if (!paid && payments.some((p) => p.status === "refunded")) return [];
  const collector = paid?.collector ?? (await collectorForAppointment(appointmentId, opts.collectors)).id;

  // Sus servicios (en orden) con la categoría y el depósito que piden hoy
  const rows = await db
    .select({ id: service.id, categoryId: service.categoryId, depositCents: service.depositCents })
    .from(appointmentService)
    .innerJoin(service, eq(service.id, appointmentService.serviceId))
    .where(eq(appointmentService.appointmentId, appointmentId))
    .orderBy(asc(appointmentService.position));
  const services =
    rows.length > 0
      ? rows
      : await db
          .select({ id: service.id, categoryId: service.categoryId, depositCents: service.depositCents })
          .from(service)
          .where(eq(service.id, appt.serviceId));

  // Se guarda lo que se pagó. Si los depósitos de los servicios cambiaron desde entonces y las
  // partes ya no suman lo pagado, se guarda todo junto en la categoría del primero.
  let parts = depositParts(services);
  if (parts.length === 0 || parts.reduce((sum, p) => sum + p.cents, 0) !== appt.depositCents) {
    const first = services[0];
    parts = [
      {
        categoryId: first?.categoryId ?? null,
        serviceId: first && first.categoryId === null ? first.id : null,
        cents: appt.depositCents,
      },
    ];
  }

  const expiresAt = savedDepositExpiry(now, opts.months, opts.zone);
  return parts.map((p) => ({
    clientId: appt.clientId,
    sourceAppointmentId: appointmentId,
    amountCents: p.cents,
    categoryId: p.categoryId,
    serviceId: p.serviceId,
    collector,
    createdAt: now,
    expiresAt,
  }));
}

export type SavedDeposit = {
  id: number;
  amountCents: number;
  origin: string; // "cancelled" | "paid_in_full"
  expiresAt: Date;
  usedAt: Date | null;
  usedAppointmentId: number | null;
};

// Los depósitos que se guardaron al anular esta cita
export async function depositsSavedFrom(appointmentId: number): Promise<SavedDeposit[]> {
  return db
    .select({
      id: depositCredit.id,
      amountCents: depositCredit.amountCents,
      origin: depositCredit.origin,
      expiresAt: depositCredit.expiresAt,
      usedAt: depositCredit.usedAt,
      usedAppointmentId: depositCredit.usedAppointmentId,
    })
    .from(depositCredit)
    .where(eq(depositCredit.sourceAppointmentId, appointmentId))
    .orderBy(asc(depositCredit.id));
}

// ¿Cuándo se pagó el depósito de esta cita? (para ofrecer guardarlo al anular)
export async function depositPaidAt(appointmentId: number): Promise<Date | null> {
  const [row] = await db
    .select({ paidAt: appointment.depositPaidAt })
    .from(appointment)
    .where(eq(appointment.id, appointmentId));
  return row?.paidAt ?? null;
}

// ---- Guardarlo al cobrar en caja ----

export type KeepAtTillResult =
  | { ok: true; cents: number; expiresAt: Date }
  // disabled: el salón no guarda depósitos · not_started: la cita aún no ha empezado
  // not_eligible: no está confirmada, el depósito no se pagó o se devolvió · already_saved: ya se guardó
  | { ok: false; reason: "disabled" | "not_found" | "not_started" | "not_eligible" | "already_saved" };

// La clienta paga en caja el servicio entero: el depósito que ya pagó no se descuenta y se le
// guarda para otra cita, igual que al anular a tiempo. La cita no cambia.
export async function keepDepositAtTill(
  appointmentId: number,
  opts: SavedDepositOptions | undefined,
  userId: string | null,
  now: Date = new Date(),
): Promise<KeepAtTillResult> {
  if (!opts) return { ok: false, reason: "disabled" };
  const [appt] = await db
    .select({ startsAt: appointment.startsAt })
    .from(appointment)
    .where(eq(appointment.id, appointmentId));
  if (!appt) return { ok: false, reason: "not_found" };
  if (appt.startsAt > now) return { ok: false, reason: "not_started" };

  const credits = await depositCreditsToSave(appointmentId, opts, now);
  return db.transaction(async (tx) => {
    // Con la cita bloqueada, nadie más guarda a la vez: si ya hay algo guardado, no se repite
    await tx.select({ id: appointment.id }).from(appointment).where(eq(appointment.id, appointmentId)).for("update");
    const [already] = await tx
      .select({ id: depositCredit.id })
      .from(depositCredit)
      .where(eq(depositCredit.sourceAppointmentId, appointmentId))
      .limit(1);
    if (already) return { ok: false, reason: "already_saved" } as const;
    if (credits.length === 0) return { ok: false, reason: "not_eligible" } as const;
    await tx.insert(depositCredit).values(credits.map((c) => ({ ...c, origin: "paid_in_full", createdBy: userId })));
    return {
      ok: true,
      cents: credits.reduce((sum, c) => sum + c.amountCents, 0),
      expiresAt: credits[0].expiresAt,
    } as const;
  });
}

// ¿Se guardó algo del depósito de esta cita? (entonces su pago con tarjeta ya no se devuelve)
export async function hasSavedDeposit(appointmentId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: depositCredit.id })
    .from(depositCredit)
    .where(eq(depositCredit.sourceAppointmentId, appointmentId))
    .limit(1);
  return row !== undefined;
}


// ---- Usarlos al reservar ----

// Los depósitos guardados de la clienta que pagan entero el depósito de una reserva nueva:
// uno por cada parte (categoría, o servicio sin categoría), del mismo cobrador, sin usar ni
// caducados, de al menos lo que pide esa parte y salidos de citas con ese correo. Se coge el que
// antes caduca. null si alguna parte se queda sin cubrir (entonces la clienta paga el depósito).
export async function matchSavedDeposits(
  clientId: number,
  parts: DepositPart[],
  collector: string,
  email: string,
  now: Date,
): Promise<{ creditIds: number[]; cents: number } | null> {
  if (parts.length === 0) return null;
  const rows = await db
    .select({
      id: depositCredit.id,
      amountCents: depositCredit.amountCents,
      categoryId: depositCredit.categoryId,
      serviceId: depositCredit.serviceId,
    })
    .from(depositCredit)
    .innerJoin(appointment, eq(appointment.id, depositCredit.sourceAppointmentId))
    .where(
      and(
        eq(depositCredit.clientId, clientId),
        eq(depositCredit.collector, collector),
        isNull(depositCredit.usedAt),
        gt(depositCredit.expiresAt, now),
        sql`lower(${appointment.clientEmail}) = ${email.trim().toLowerCase()}`,
      ),
    )
    .orderBy(asc(depositCredit.expiresAt), asc(depositCredit.id));

  const picked: number[] = [];
  let cents = 0;
  for (const part of parts) {
    const credit = rows.find(
      (r) =>
        !picked.includes(r.id) &&
        r.amountCents >= part.cents &&
        (part.categoryId !== null ? r.categoryId === part.categoryId : r.serviceId === part.serviceId),
    );
    if (!credit) return null;
    picked.push(credit.id);
    cents += credit.amountCents;
  }
  return { creditIds: picked, cents };
}

// Las partes del depósito de unos servicios (los que pide la reserva, en su orden)
export async function depositPartsFor(serviceIds: number[]): Promise<DepositPart[]> {
  if (serviceIds.length === 0) return [];
  const rows = await db
    .select({ id: service.id, categoryId: service.categoryId, depositCents: service.depositCents })
    .from(service)
    .where(inArray(service.id, serviceIds));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return depositParts(serviceIds.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  }));
}

export type UsedDeposit = { id: number; amountCents: number; sourceAppointmentId: number };

// Los depósitos guardados con los que se pagó esta cita
export async function depositsUsedBy(appointmentId: number): Promise<UsedDeposit[]> {
  return db
    .select({
      id: depositCredit.id,
      amountCents: depositCredit.amountCents,
      sourceAppointmentId: depositCredit.sourceAppointmentId,
    })
    .from(depositCredit)
    .where(eq(depositCredit.usedAppointmentId, appointmentId))
    .orderBy(asc(depositCredit.id));
}
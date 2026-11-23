// Depósitos guardados (booking.deposit.saved): qué se guarda al anular una cita con el depósito
// pagado, y lo que se enseña de ellos. Usarlos al reservar llega en Pag4b.
import { asc, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "../db";
import { appointment, appointmentService, depositCredit, payment, service } from "../db/schema";
import { resolveCollector } from "./collectors";
import { collectorForAppointment } from "./collectors-db";
import { depositParts } from "./deposit";
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

// Lo que habría que guardar al anular esta cita: una fila por categoría de su depósito.
// Vacío si no hay nada que guardar: no estaba confirmada, el depósito no se pagó, o se devolvió.
// Solo lee: quien anula lo inserta en la misma transacción que la anulación.
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
  if (!appt || appt.status !== "booked" || appt.depositCents === null || appt.depositPaidAt === null) return [];

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
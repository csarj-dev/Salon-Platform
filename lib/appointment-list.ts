import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db";
import { appointment, client, location, service, staff, user } from "../db/schema";

export type AppointmentStatus = typeof appointment.$inferSelect.status;

export type AppointmentListRow = {
  id: number;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  source: "web" | "phone" | "whatsapp";
  clientName: string;
  clientPhone: string;
  serviceName: string;
  locationName: string;
  staffName: string;
  depositCents: number | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  // Quién del equipo canceló / validó el depósito (null si no consta)
  cancelledByName: string | null;
  validatedByName: string | null;
};

export type ListAppointmentsOptions = {
  /** Inclusive */
  from?: Date;
  /** Exclusive */
  to?: Date;
  statuses: AppointmentStatus[];
  order: "asc" | "desc";
  limit?: number;
};

export async function listAppointments(
  opts: ListAppointmentsOptions,
): Promise<AppointmentListRow[]> {
  const canceller = alias(user, "canceller");
  const validator = alias(user, "validator");

  const conditions = [inArray(appointment.status, opts.statuses)];
  if (opts.from) conditions.push(gte(appointment.startsAt, opts.from));
  if (opts.to) conditions.push(lt(appointment.startsAt, opts.to));

  return db
    .select({
      id: appointment.id,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      status: appointment.status,
      source: appointment.source,
      clientName: client.name,
      clientPhone: client.phone,
      serviceName: service.name,
      locationName: location.name,
      staffName: staff.name,
      depositCents: appointment.depositCents,
      cancelledAt: appointment.cancelledAt,
      cancelReason: appointment.cancelReason,
      cancelledByName: canceller.name,
      validatedByName: validator.name,
    })
    .from(appointment)
    .innerJoin(client, eq(client.id, appointment.clientId))
    .innerJoin(service, eq(service.id, appointment.serviceId))
    .innerJoin(location, eq(location.id, appointment.locationId))
    .innerJoin(staff, eq(staff.id, appointment.staffId))
    .leftJoin(canceller, eq(canceller.id, appointment.cancelledBy))
    .leftJoin(validator, eq(validator.id, appointment.depositValidatedBy))
    .where(and(...conditions))
    .orderBy(opts.order === "asc" ? asc(appointment.startsAt) : desc(appointment.startsAt))
    .limit(opts.limit ?? 200);
}
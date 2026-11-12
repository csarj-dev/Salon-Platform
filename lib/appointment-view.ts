import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { appointment, location, service, serviceTranslation, staff } from "../db/schema";
import { isDepositOverdue } from "./deposit";
import { pickTranslation } from "./pick-translation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AppointmentStatus =
  | "booked" | "completed" | "cancelled" | "no_show" | "pending_deposit" | "expired";

export type ConfirmationView = {
  id: number;
  // Un depósito pendiente cuyo plazo ya venció se enseña como caducado aunque
  // nadie haya liberado todavía el hueco
  status: AppointmentStatus;
  startsAt: Date;
  endsAt: Date;
  serviceName: string;
  locationName: string;
  locationAddress: string | null;
  staffName: string;
  priceCents: number;
  depositCents: number | null;
  depositDueAt: Date | null;
  rescheduledAt: Date | null; // última vez que se cambió de hora
};

// Datos de la página de confirmación. Se llega solo con el token secreto de la cita
// (nada de ids que se puedan adivinar) y no se devuelven datos de contacto de la clienta.
export async function getConfirmation(
  token: string,
  locale: string,
  defaultLocale: string,
  now: Date, // la pasa quien llama, después de esperar a la petición (ver ConfirmationContent)
): Promise<ConfirmationView | null> {
  // Si no tiene forma de UUID, Postgres daría error al compararlo: ni se pregunta
  if (!UUID.test(token)) return null;

  const [row] = await db
    .select({
      id: appointment.id,
      status: appointment.status,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      serviceId: appointment.serviceId,
      serviceName: service.name,
      locationName: location.name,
      locationAddress: location.address,
      staffName: staff.name,
      priceCents: appointment.priceAppliedCents,
      depositCents: appointment.depositCents,
      depositDueAt: appointment.depositDueAt,
      rescheduledAt: appointment.rescheduledAt,
    })
    .from(appointment)
    .innerJoin(service, eq(service.id, appointment.serviceId))
    .innerJoin(location, eq(location.id, appointment.locationId))
    .innerJoin(staff, eq(staff.id, appointment.staffId))
    .where(eq(appointment.publicToken, token.toLowerCase()));
  if (!row) return null;

  const translations = await db
    .select()
    .from(serviceTranslation)
    .where(
      and(
        eq(serviceTranslation.serviceId, row.serviceId),
        inArray(serviceTranslation.locale, [...new Set([locale, defaultLocale])]),
      ),
    );

  const status: AppointmentStatus = isDepositOverdue(row, now) ? "expired" : row.status;

  return {
    id: row.id,
    status,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    serviceName: pickTranslation(translations, locale, defaultLocale, row.serviceName).name,
    locationName: row.locationName,
    locationAddress: row.locationAddress,
    staffName: row.staffName,
    priceCents: row.priceCents,
    depositCents: row.depositCents,
    depositDueAt: row.depositDueAt,
    rescheduledAt: row.rescheduledAt,
  };
}

// Id de la cita a partir de su token secreto (para lo que hace la clienta desde su enlace)
export async function findAppointmentIdByToken(token: string): Promise<number | null> {
  if (typeof token !== "string" || !UUID.test(token)) return null;
  const [row] = await db
    .select({ id: appointment.id })
    .from(appointment)
    .where(eq(appointment.publicToken, token.toLowerCase()));
  return row?.id ?? null;
}

// Lo que necesita la página de cambiar de hora (enlace de la clienta, con su token)
export type ChangeTarget = {
  id: number;
  status: AppointmentStatus;
  startsAt: Date;
  endsAt: Date;
  staffId: number;
  staffName: string;
  locationId: number;
  serviceId: number;
  serviceName: string;
};

export async function getChangeTarget(
  token: string,
  locale: string,
  defaultLocale: string,
): Promise<ChangeTarget | null> {
  if (typeof token !== "string" || !UUID.test(token)) return null;
  const [row] = await db
    .select({
      id: appointment.id,
      status: appointment.status,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      staffId: appointment.staffId,
      staffName: staff.name,
      locationId: appointment.locationId,
      serviceId: appointment.serviceId,
      serviceName: service.name,
    })
    .from(appointment)
    .innerJoin(service, eq(service.id, appointment.serviceId))
    .innerJoin(staff, eq(staff.id, appointment.staffId))
    .where(eq(appointment.publicToken, token.toLowerCase()));
  if (!row) return null;

  const translations = await db
    .select()
    .from(serviceTranslation)
    .where(
      and(
        eq(serviceTranslation.serviceId, row.serviceId),
        inArray(serviceTranslation.locale, [...new Set([locale, defaultLocale])]),
      ),
    );
  return { ...row, serviceName: pickTranslation(translations, locale, defaultLocale, row.serviceName).name };
}

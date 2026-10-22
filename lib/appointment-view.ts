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
  };
}

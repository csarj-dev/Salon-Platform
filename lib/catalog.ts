import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  location, locationService, schedule, service,
  serviceTranslation, staff, staffService,
} from "../db/schema";
import { pickTranslation } from "./pick-translation";

export async function listActiveLocations() {
  return db
    .select({
      id: location.id,
      name: location.name,
      address: location.address,
      phone: location.phone,
    })
    .from(location)
    .where(eq(location.active, true))
    .orderBy(asc(location.name));
}

export type CatalogService = {
  id: number;
  name: string;
  description: string | null;
  durationMin: number;
  priceCents: number;
};

// Servicios que ofrece un local, con nombre en el idioma pedido
// y el precio propio del local si lo tiene
export async function listServicesForLocation(
  locationId: number,
  locale: string,
  defaultLocale: string,
): Promise<CatalogService[]> {
  const rows = await db
    .select({
      id: service.id,
      name: service.name,
      durationMin: service.durationMin,
      basePrice: service.priceCents,
      override: locationService.priceCents,
    })
    .from(locationService)
    .innerJoin(service, eq(service.id, locationService.serviceId))
    .where(eq(locationService.locationId, locationId));

  if (rows.length === 0) return [];

  const translations = await db
    .select()
    .from(serviceTranslation)
    .where(
      and(
        inArray(serviceTranslation.serviceId, rows.map((r) => r.id)),
        inArray(serviceTranslation.locale, [...new Set([locale, defaultLocale])]),
      ),
    );

  return rows
    .map((r) => ({
      id: r.id,
      ...pickTranslation(
        translations.filter((t) => t.serviceId === r.id),
        locale,
        defaultLocale,
        r.name,
      ),
      durationMin: r.durationMin,
      priceCents: r.override ?? r.basePrice,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}

// Profesionales activas que hacen el servicio y trabajan en ese local
export async function listStaffForService(locationId: number, serviceId: number) {
  return db
    .selectDistinct({ id: staff.id, name: staff.name })
    .from(staff)
    .innerJoin(staffService, eq(staffService.staffId, staff.id))
    .innerJoin(schedule, eq(schedule.staffId, staff.id))
    .where(
      and(
        eq(staffService.serviceId, serviceId),
        eq(schedule.locationId, locationId),
        eq(staff.active, true),
      ),
    )
    .orderBy(asc(staff.name));
}
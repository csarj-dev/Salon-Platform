import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  location, locationHours, locationService, schedule, service,
  serviceCategory, serviceCategoryTranslation, serviceTranslation,
  staff, staffService,
} from "../db/schema";
import { pickTranslation } from "./pick-translation";
import type { HoursRow } from "./opening-hours";

export async function listActiveLocations() {
  return db
    .select({
      id: location.id,
      name: location.name,
      address: location.address,
      phone: location.phone,
      mapsUrl: location.mapsUrl,
      photoId: location.photoId,
    })
    .from(location)
    .where(eq(location.active, true))
    .orderBy(asc(location.name));
}

// Locales activos con su horario de apertura (filas sin agrupar; ver lib/opening-hours.ts)
export async function listLocationsWithHours() {
  const locations = await listActiveLocations();
  if (locations.length === 0) return [];

  const hours = await db
    .select({
      locationId: locationHours.locationId,
      weekday: locationHours.weekday,
      openTime: locationHours.openTime,
      closeTime: locationHours.closeTime,
    })
    .from(locationHours)
    .where(inArray(locationHours.locationId, locations.map((l) => l.id)))
    .orderBy(asc(locationHours.weekday), asc(locationHours.openTime));

  return locations.map((l) => ({
    ...l,
    hours: hours
      .filter((h) => h.locationId === l.id)
      .map(({ weekday, openTime, closeTime }): HoursRow => ({ weekday, openTime, closeTime })),
  }));
}

export type CatalogService = {
  id: number;
  name: string;
  description: string | null;
  durationMin: number;
  priceCents: number;
  categoryId: number | null;
  requiresConsultation: boolean;
  photoId: number | null;
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
      categoryId: service.categoryId,
      sortOrder: service.sortOrder,
      requiresConsultation: service.requiresConsultation,
      photoId: service.photoId,
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
      sortOrder: r.sortOrder,
      service: {
        id: r.id,
        ...pickTranslation(
          translations.filter((t) => t.serviceId === r.id),
          locale,
          defaultLocale,
          r.name,
        ),
        durationMin: r.durationMin,
        priceCents: r.override ?? r.basePrice,
        categoryId: r.categoryId,
        requiresConsultation: r.requiresConsultation,
        photoId: r.photoId,
      },
    }))
    .sort(
      (a, b) =>
        a.sortOrder - b.sortOrder || a.service.name.localeCompare(b.service.name, locale),
    )
    .map((x) => x.service);
}

export type ServiceGroup = {
  categoryId: number | null; // null = servicios sin categoría
  name: string | null;
  services: CatalogService[];
};

// La carta de un local: servicios agrupados por categoría, en el orden de la categoría.
// Los servicios sin categoría van en un último grupo con name null.
// No devuelve categorías vacías.
export async function listServicesByCategory(
  locationId: number,
  locale: string,
  defaultLocale: string,
): Promise<ServiceGroup[]> {
  const services = await listServicesForLocation(locationId, locale, defaultLocale);
  if (services.length === 0) return [];

  const categoryIds = [
    ...new Set(services.map((s) => s.categoryId).filter((id): id is number => id !== null)),
  ];

  const categories = categoryIds.length
    ? await db.select().from(serviceCategory).where(inArray(serviceCategory.id, categoryIds))
    : [];
  const translations = categoryIds.length
    ? await db
        .select()
        .from(serviceCategoryTranslation)
        .where(
          and(
            inArray(serviceCategoryTranslation.categoryId, categoryIds),
            inArray(serviceCategoryTranslation.locale, [...new Set([locale, defaultLocale])]),
          ),
        )
    : [];

  const groups: ServiceGroup[] = categories
    .map((c) => ({
      sortOrder: c.sortOrder,
      group: {
        categoryId: c.id,
        name: pickTranslation(
          translations
            .filter((t) => t.categoryId === c.id)
            .map((t) => ({ locale: t.locale, name: t.name, description: null })),
          locale,
          defaultLocale,
          c.name,
        ).name,
        services: services.filter((s) => s.categoryId === c.id),
      },
    }))
    .sort(
      (a, b) =>
        a.sortOrder - b.sortOrder || (a.group.name ?? "").localeCompare(b.group.name ?? "", locale),
    )
    .map((x) => x.group);

  const uncategorized = services.filter((s) => s.categoryId === null);
  if (uncategorized.length > 0) {
    groups.push({ categoryId: null, name: null, services: uncategorized });
  }
  return groups;
}

// Profesionales activas que hacen el servicio y trabajan en ese local
export async function listStaffForService(locationId: number, serviceId: number) {
  return db
    .selectDistinct({ id: staff.id, name: staff.name, photoId: staff.photoId })
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

export type FeaturedService = {
  id: number;
  name: string;
  description: string | null;
};

// Servicios destacados de la portada: marcados como `featured` y ofrecidos en algún
// local activo, una vez cada uno. Sin precio: depende del local (ver /services).
export async function listFeaturedServices(
  locale: string,
  defaultLocale: string,
  limit = 6,
): Promise<FeaturedService[]> {
  const rows = await db
    .selectDistinct({ id: service.id, name: service.name, sortOrder: service.sortOrder })
    .from(service)
    .innerJoin(locationService, eq(locationService.serviceId, service.id))
    .innerJoin(location, eq(location.id, locationService.locationId))
    .where(and(eq(service.featured, true), eq(location.active, true)))
    .orderBy(asc(service.sortOrder), asc(service.name), asc(service.id))
    .limit(limit);

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

  return rows.map((r) => ({
    id: r.id,
    ...pickTranslation(
      translations.filter((t) => t.serviceId === r.id),
      locale,
      defaultLocale,
      r.name,
    ),
  }));
}
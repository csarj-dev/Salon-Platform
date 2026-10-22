import { and, asc, count, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../db";
import {
  location, locationHours, locationService, schedule, service,
  serviceCategory, serviceCategoryTranslation, servicePhoto, serviceTranslation,
  staff, staffService, locationPhoto, staffTranslation
} from "../db/schema";
import { pickTranslation } from "./pick-translation";
import { hasServiceDetail, pickLongDescription } from "./service-detail";
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
      slug: location.slug,
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
  slug: string | null;
  hasDetail: boolean; // ¿tiene página propia con contenido?
  depositCents: number | null; // depósito que se pide al reservar por la web
};

// ¿Qué servicios tienen contenido para una página propia?
// (slug + descripción larga o al menos una foto en la galería)
async function detailFlags(
  rows: { id: number; slug: string | null }[],
  translations: { serviceId: number; locale: string; longDescription: string | null }[],
  locale: string,
  defaultLocale: string,
): Promise<Map<number, boolean>> {
  const galleryCounts = await db
    .select({ serviceId: servicePhoto.serviceId, total: count() })
    .from(servicePhoto)
    .where(inArray(servicePhoto.serviceId, rows.map((r) => r.id)))
    .groupBy(servicePhoto.serviceId);

  return new Map(
    rows.map((r): [number, boolean] => [
      r.id,
      hasServiceDetail({
        slug: r.slug,
        longDescription: pickLongDescription(
          translations.filter((t) => t.serviceId === r.id),
          locale,
          defaultLocale,
        ),
        galleryCount: galleryCounts.find((g) => g.serviceId === r.id)?.total ?? 0,
      }),
    ]),
  );
}

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
      depositCents: service.depositCents,
      photoId: service.photoId,
      slug: service.slug,
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

  const detail = await detailFlags(rows, translations, locale, defaultLocale);

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
        depositCents: r.depositCents,
        photoId: r.photoId,
        slug: r.slug,
        hasDetail: detail.get(r.id) ?? false,
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
  photoId: number | null;
  slug: string | null;
  hasDetail: boolean;
};

// Servicios destacados de la portada: marcados como `featured` y ofrecidos en algún
// local activo, una vez cada uno. Sin precio: depende del local (ver /services).
export async function listFeaturedServices(
  locale: string,
  defaultLocale: string,
  limit = 6,
): Promise<FeaturedService[]> {
  const rows = await db
    .selectDistinct({
      id: service.id,
      name: service.name,
      sortOrder: service.sortOrder,
      photoId: service.photoId,
      slug: service.slug,
    })
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
  const detail = await detailFlags(rows, translations, locale, defaultLocale);

  return rows.map((r) => ({
    id: r.id,
    ...pickTranslation(
      translations.filter((t) => t.serviceId === r.id),
      locale,
      defaultLocale,
      r.name,
    ),
    photoId: r.photoId,
    slug: r.slug,
    hasDetail: detail.get(r.id) ?? false,
  }));
}

// Un local activo por su slug, con su horario de apertura (sin agrupar).
// null si no existe o está inactivo.
export async function getLocationBySlug(slug: string) {
  const [row] = await db
    .select({
      id: location.id,
      slug: location.slug,
      name: location.name,
      address: location.address,
      phone: location.phone,
      mapsUrl: location.mapsUrl,
      photoId: location.photoId,
    })
    .from(location)
    .where(and(eq(location.slug, slug), eq(location.active, true)));
  if (!row) return null;

  const hours = await db
    .select({
      weekday: locationHours.weekday,
      openTime: locationHours.openTime,
      closeTime: locationHours.closeTime,
    })
    .from(locationHours)
    .where(eq(locationHours.locationId, row.id))
    .orderBy(asc(locationHours.weekday), asc(locationHours.openTime));

  return {
    ...row,
    hours: hours.map(({ weekday, openTime, closeTime }): HoursRow => ({ weekday, openTime, closeTime })),
  };
}

// Ids de las fotos de la galería de un local, en el orden elegido
export async function listLocationGalleryPhotoIds(locationId: number): Promise<number[]> {
  const rows = await db
    .select({ photoId: locationPhoto.photoId })
    .from(locationPhoto)
    .where(eq(locationPhoto.locationId, locationId))
    .orderBy(asc(locationPhoto.sortOrder), asc(locationPhoto.photoId));
  return rows.map((r) => r.photoId);
}

export type TeamMember = {
  id: number;
  name: string;
  photoId: number | null;
  role: string | null;
  bio: string | null;
  locations: { id: number; name: string; slug: string | null }[];
};

// Profesionales publicadas en la web: activas y con `listed_on_team_at`, en el orden en que
// se publicaron. Cargo y bio en el idioma pedido (o el idioma por defecto si falta).
// Con `locationId`, solo las que trabajan en ese local.
export async function listTeam(
  locale: string,
  defaultLocale: string,
  options: { locationId?: number } = {},
): Promise<TeamMember[]> {
  const members = await db
    .select({ id: staff.id, name: staff.name, photoId: staff.photoId })
    .from(staff)
    .where(and(eq(staff.active, true), isNotNull(staff.listedOnTeamAt)))
    .orderBy(asc(staff.listedOnTeamAt), asc(staff.name), asc(staff.id));
  if (members.length === 0) return [];

  const ids = members.map((m) => m.id);
  const [translations, places] = await Promise.all([
    db
      .select()
      .from(staffTranslation)
      .where(
        and(
          inArray(staffTranslation.staffId, ids),
          inArray(staffTranslation.locale, [...new Set([locale, defaultLocale])]),
        ),
      ),
    db
      .selectDistinct({
        staffId: schedule.staffId,
        id: location.id,
        name: location.name,
        slug: location.slug,
      })
      .from(schedule)
      .innerJoin(location, eq(location.id, schedule.locationId))
      .where(and(inArray(schedule.staffId, ids), eq(location.active, true)))
      .orderBy(asc(location.name)),
  ]);

  const team = members.map((m): TeamMember => {
    const picked = pickTranslation(
      translations
        .filter((t) => t.staffId === m.id)
        .map((t) => ({ locale: t.locale, name: t.role ?? "", description: t.bio })),
      locale,
      defaultLocale,
      "",
    );
    return {
      ...m,
      role: picked.name || null,
      bio: picked.description,
      locations: places
        .filter((p) => p.staffId === m.id)
        .map(({ id, name, slug }) => ({ id, name, slug })),
    };
  });

  return options.locationId === undefined
    ? team
    : team.filter((m) => m.locations.some((l) => l.id === options.locationId));
}

// ¿Hay al menos una profesional publicada? (para mostrar o no el enlace "Equipo")
export async function hasListedTeam(): Promise<boolean> {
  const [row] = await db
    .select({ id: staff.id })
    .from(staff)
    .where(and(eq(staff.active, true), isNotNull(staff.listedOnTeamAt)))
    .limit(1);
  return row !== undefined;
}

export type ServiceOffer = {
  location: { id: number; name: string; slug: string | null };
  durationMin: number;
  priceCents: number;
};

export type ServiceDetail = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  longDescription: string | null;
  photoId: number | null;
  requiresConsultation: boolean;
  galleryPhotoIds: number[];
  offers: ServiceOffer[]; // un elemento por local activo que lo ofrece
};

// Un servicio por su slug. Devuelve null si no existe, si no se ofrece en ningún local
// activo o si no tiene contenido que mostrar (descripción larga o galería): sin datos, sin página.
export async function getServiceBySlug(
  slug: string,
  locale: string,
  defaultLocale: string,
): Promise<ServiceDetail | null> {
  const [row] = await db
    .select({
      id: service.id,
      name: service.name,
      durationMin: service.durationMin,
      basePrice: service.priceCents,
      photoId: service.photoId,
      requiresConsultation: service.requiresConsultation,
    })
    .from(service)
    .where(eq(service.slug, slug));
  if (!row) return null;

  const [translations, gallery, offerRows] = await Promise.all([
    db
      .select()
      .from(serviceTranslation)
      .where(
        and(
          eq(serviceTranslation.serviceId, row.id),
          inArray(serviceTranslation.locale, [...new Set([locale, defaultLocale])]),
        ),
      ),
    db
      .select({ photoId: servicePhoto.photoId })
      .from(servicePhoto)
      .where(eq(servicePhoto.serviceId, row.id))
      .orderBy(asc(servicePhoto.sortOrder), asc(servicePhoto.photoId)),
    db
      .select({
        id: location.id,
        name: location.name,
        slug: location.slug,
        override: locationService.priceCents,
      })
      .from(locationService)
      .innerJoin(location, eq(location.id, locationService.locationId))
      .where(and(eq(locationService.serviceId, row.id), eq(location.active, true)))
      .orderBy(asc(location.name)),
  ]);
  if (offerRows.length === 0) return null;

  const longDescription = pickLongDescription(translations, locale, defaultLocale);
  const galleryPhotoIds = gallery.map((g) => g.photoId);
  if (!hasServiceDetail({ slug, longDescription, galleryCount: galleryPhotoIds.length })) {
    return null;
  }

  const picked = pickTranslation(translations, locale, defaultLocale, row.name);
  return {
    id: row.id,
    slug,
    name: picked.name,
    description: picked.description,
    longDescription,
    photoId: row.photoId,
    requiresConsultation: row.requiresConsultation,
    galleryPhotoIds,
    offers: offerRows.map((o) => ({
      location: { id: o.id, name: o.name, slug: o.slug },
      durationMin: row.durationMin,
      priceCents: o.override ?? row.basePrice,
    })),
  };
}
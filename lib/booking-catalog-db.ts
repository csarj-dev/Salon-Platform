// Carga lo que necesita el panel «Nueva cita» (ver lib/booking-catalog.ts). Cinco consultas
// pequeñas: unos pocos locales, profesionales y servicios.
import { asc, eq } from "drizzle-orm";
import { db } from "../db";
import { location, locationService, service, serviceCategory, staff, staffService } from "../db/schema";
import type { BookingCatalog } from "./booking-catalog";

export async function loadBookingCatalog(): Promise<BookingCatalog> {
  const [locations, team, services, offers, skills] = await Promise.all([
    db.select({ id: location.id, name: location.name }).from(location).where(eq(location.active, true)).orderBy(asc(location.name)),
    db
      .select({ id: staff.id, name: staff.name, koiboxAccount: staff.koiboxAccount })
      .from(staff)
      .where(eq(staff.active, true))
      .orderBy(asc(staff.name)),
    db
      .select({
        id: service.id,
        name: service.name,
        durationMin: service.durationMin,
        priceCents: service.priceCents,
        depositCents: service.depositCents,
        categoryId: service.categoryId,
      })
      .from(service)
      .leftJoin(serviceCategory, eq(serviceCategory.id, service.categoryId))
      .orderBy(asc(serviceCategory.sortOrder), asc(service.sortOrder), asc(service.name)),
    db
      .select({ locationId: locationService.locationId, serviceId: locationService.serviceId, priceCents: locationService.priceCents })
      .from(locationService),
    db.select({ staffId: staffService.staffId, serviceId: staffService.serviceId }).from(staffService),
  ]);
  return { locations, staff: team, services, offers, skills };
}
// Varios servicios seguidos en la misma cita (p. ej. laminado + diseño de cejas).
// Las funciones de horas y profesionales aceptan uno o varios: con varios, la cita dura la suma,
// el local tiene que ofrecerlos todos y solo valen las profesionales que los hacen todos.
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { locationService, service, staffService } from "../db/schema";

// Un servicio (como hasta ahora) o varios, en el orden en que se hacen
export type ServiceIds = number | readonly number[];

// Siempre como lista, sin repetidos y en el mismo orden
export function serviceIdList(services: ServiceIds): number[] {
  const list = typeof services === "number" ? [services] : services;
  return [...new Set(list)];
}

// Los servicios existen y este local los ofrece todos: devuelve la lista y la duración total
// (la de base de cada servicio). null si falta alguno o la lista está vacía.
export async function loadServiceSet(
  locationId: number,
  services: ServiceIds,
): Promise<{ ids: number[]; durationMin: number } | null> {
  const ids = serviceIdList(services);
  if (ids.length === 0) return null;
  const rows = await db
    .select({ id: service.id, durationMin: service.durationMin })
    .from(service)
    .innerJoin(
      locationService,
      and(eq(locationService.serviceId, service.id), eq(locationService.locationId, locationId)),
    )
    .where(inArray(service.id, ids));
  if (rows.length !== ids.length) return null;
  return { ids, durationMin: rows.reduce((total, r) => total + r.durationMin, 0) };
}

// Profesionales (ids) que hacen TODOS los servicios de la lista. No mira si están activas
// ni dónde trabajan: eso lo filtra quien llama.
export async function staffDoingAll(serviceIds: number[]): Promise<number[]> {
  if (serviceIds.length === 0) return [];
  const rows = await db
    .select({ staffId: staffService.staffId })
    .from(staffService)
    .where(inArray(staffService.serviceId, serviceIds))
    .groupBy(staffService.staffId)
    .having(sql`count(distinct ${staffService.serviceId}) = ${serviceIds.length}`);
  return rows.map((r) => r.staffId);
}
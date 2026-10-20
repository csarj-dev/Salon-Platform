import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import { staff, staffService } from "../db/schema";
import { getAvailabilityForDay, type AvailabilityOptions } from "./availability-db";
import { mergeSlots, type AnySlot, type StaffSlots } from "./merge-slots";

export type ServiceAvailability = {
  perStaff: StaffSlots[]; // para quien elige una profesional concreta
  any: AnySlot[];         // para quien elige "cualquiera"
};

export async function getAvailabilityForService(
  locationId: number,
  serviceId: number,
  date: string, // "2026-11-02", fecha local del salón
  opts: AvailabilityOptions,
  now: Date = new Date(),
): Promise<ServiceAvailability> {
  // Profesionales activas que hacen este servicio
  const team = await db
    .select({ id: staff.id, name: staff.name })
    .from(staff)
    .innerJoin(staffService, eq(staffService.staffId, staff.id))
    .where(and(eq(staffService.serviceId, serviceId), eq(staff.active, true)))
    .orderBy(asc(staff.name));

  const results = await Promise.all(
    team.map(async (member) => ({
      staffId: member.id,
      staffName: member.name,
      slots: await getAvailabilityForDay(locationId, member.id, serviceId, date, opts, now),
    })),
  );

  // Solo las que tienen algún hueco ese día
  const perStaff = results.filter((r) => r.slots.length > 0);
  return { perStaff, any: mergeSlots(perStaff) };
}
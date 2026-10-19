import "dotenv/config";
import { eq, count } from "drizzle-orm";
import { db } from "./index";
import { service, staff, staffService } from "./schema";

async function main() {
  // Ejercicio 2: ¿qué servicios hace Lucía?
  const luciaServices = await db
    .select({ name: service.name, priceCents: service.priceCents })
    .from(staff)
    .innerJoin(staffService, eq(staffService.staffId, staff.id))
    .innerJoin(service, eq(service.id, staffService.serviceId))
    .where(eq(staff.name, "Lucía"));

  console.log("Servicios de Lucía:", luciaServices);

  // Ejercicio 3: cuántas profesionales hace cada servicio
  const perService = await db
    .select({ name: service.name, staffCount: count(staffService.staffId) })
    .from(service)
    .leftJoin(staffService, eq(staffService.serviceId, service.id))
    .groupBy(service.name);

  console.log("Profesionales por servicio:", perService);
  process.exit(0);
}

main();
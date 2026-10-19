import "dotenv/config";
import { db } from "./index";
import { service, staff, staffService, client, appointment } from "./schema";

async function main() {
  // Solo para desarrollo: vacía y vuelve a cargar
  await db.delete(appointment);
  await db.delete(client);
  await db.delete(staffService);
  await db.delete(staff);
  await db.delete(service);

  const services = await db
    .insert(service)
    .values([
      { name: "Laminado de cejas", durationMin: 60, priceCents: 4500 },
      { name: "Diseño de cejas", durationMin: 30, priceCents: 1800 },
      { name: "Lifting de pestañas", durationMin: 75, priceCents: 5500 },
    ])
    .returning();

  const team = await db
    .insert(staff)
    .values([{ name: "Ana" }, { name: "Lucía" }, { name: "Marta" }])
    .returning();

  const [lam, dis, lif] = services;
  const [ana, lucia, marta] = team;

  await db.insert(staffService).values([
    { staffId: ana.id, serviceId: lam.id },
    { staffId: ana.id, serviceId: dis.id },
    { staffId: lucia.id, serviceId: dis.id },
    { staffId: lucia.id, serviceId: lif.id },
    { staffId: marta.id, serviceId: lam.id },
    { staffId: marta.id, serviceId: lif.id },
  ]);

  console.log("Seed completado");
  process.exit(0);
}

main();
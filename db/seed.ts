import "dotenv/config";
import { db } from "./index";
import {
  location, locationService, service, staff, staffService,
  client, appointment, schedule, timeOff,
} from "./schema";

type Shift = [string, string];

// Una fila por día y por turno: turnos partidos = varios turnos
function weekly(staffId: number, locationId: number, days: number[], shifts: Shift[]) {
  return days.flatMap((weekday) =>
    shifts.map(([startTime, endTime]) => ({
      staffId, locationId, weekday, startTime, endTime,
    })),
  );
}

async function main() {
  // Primero lo que depende de otras tablas
  await db.delete(appointment);
  await db.delete(timeOff);
  await db.delete(schedule);
  await db.delete(locationService);
  await db.delete(staffService);
  await db.delete(client);
  await db.delete(staff);
  await db.delete(service);
  await db.delete(location);

  const [centro, sur] = await db
    .insert(location)
    .values([
      { name: "The Room Centro", address: "Dirección de ejemplo 1" },
      { name: "The Room Sur", address: "Dirección de ejemplo 2" },
    ])
    .returning();

  const [lam, dis, lif] = await db
    .insert(service)
    .values([
      { name: "Laminado de cejas", durationMin: 60, priceCents: 4500 },
      { name: "Diseño de cejas", durationMin: 30, priceCents: 1800 },
      { name: "Lifting de pestañas", durationMin: 75, priceCents: 5500 },
    ])
    .returning();

  const [ana, lucia, marta] = await db
    .insert(staff)
    .values([{ name: "Ana" }, { name: "Lucía" }, { name: "Marta" }])
    .returning();

  // Centro ofrece todo; Sur no ofrece el lifting
  await db.insert(locationService).values([
    { locationId: centro.id, serviceId: lam.id },
    { locationId: centro.id, serviceId: dis.id },
    { locationId: centro.id, serviceId: lif.id },
    { locationId: sur.id, serviceId: lam.id },
    { locationId: sur.id, serviceId: dis.id },
  ]);

  await db.insert(staffService).values([
    { staffId: ana.id, serviceId: lam.id },
    { staffId: ana.id, serviceId: dis.id },
    { staffId: lucia.id, serviceId: dis.id },
    { staffId: lucia.id, serviceId: lif.id },
    { staffId: marta.id, serviceId: lam.id },
    { staffId: marta.id, serviceId: lif.id },
  ]);

  // 1 = lunes ... 7 = domingo
  await db.insert(schedule).values([
    // Ana: lunes y martes en Centro, miércoles a viernes en Sur, turno partido
    ...weekly(ana.id, centro.id, [1, 2], [["10:00", "14:00"], ["16:00", "20:00"]]),
    ...weekly(ana.id, sur.id, [3, 4, 5], [["10:00", "14:00"], ["16:00", "20:00"]]),
    // Lucía: lunes a sábado en Centro, turno continuo
    ...weekly(lucia.id, centro.id, [1, 2, 3, 4, 5, 6], [["09:00", "15:00"]]),
    // Marta: lunes, miércoles y viernes en Sur, tarde
    ...weekly(marta.id, sur.id, [1, 3, 5], [["12:00", "20:00"]]),
  ]);

  const [clienta] = await db
    .insert(client)
    .values({ name: "Clienta de prueba", phone: "600000000" })
    .returning();

  // Lunes 2 de noviembre de 2026 (Canarias, UTC+0): Ana en Centro
  await db.insert(appointment).values({
    clientId: clienta.id,
    serviceId: lam.id,
    staffId: ana.id,
    locationId: centro.id,
    startsAt: new Date("2026-11-02T11:00:00Z"),
    endsAt: new Date("2026-11-02T12:00:00Z"),
    priceAppliedCents: lam.priceCents,
    source: "web",
  });

  // Lucía no trabaja el martes 3 de noviembre
  await db.insert(timeOff).values({
    staffId: lucia.id,
    startsAt: new Date("2026-11-03T00:00:00Z"),
    endsAt: new Date("2026-11-04T00:00:00Z"),
    reason: "Día libre",
  });

  console.log("Seed completado");
  process.exit(0);
}

main();
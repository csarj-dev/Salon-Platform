import "dotenv/config";
import { db } from "./index";
import {
  service, staff, staffService, client, appointment, schedule, timeOff,
} from "./schema";

type Shift = [string, string];

// Genera una fila por día y por turno: turnos partidos = varios turnos
function weekly(staffId: number, days: number[], shifts: Shift[]) {
  return days.flatMap((weekday) =>
    shifts.map(([startTime, endTime]) => ({ staffId, weekday, startTime, endTime })),
  );
}

async function main() {
  // Orden: primero lo que depende de otras tablas
  await db.delete(appointment);
  await db.delete(timeOff);
  await db.delete(schedule);
  await db.delete(staffService);
  await db.delete(client);
  await db.delete(staff);
  await db.delete(service);

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
    // Ana: turno partido, lunes a viernes
    ...weekly(ana.id, [1, 2, 3, 4, 5], [["10:00", "20:00"]]),
    // Lucía: turno continuo, lunes a sábado
    ...weekly(lucia.id, [1, 2, 3, 4, 5, 6], [["09:00", "15:00"]]),
    // Marta: lunes, miércoles y viernes, tarde
    ...weekly(marta.id, [1, 3, 5], [["12:00", "20:00"]]),
  ]);

  const [clienta] = await db
    .insert(client)
    .values({ name: "Clienta de prueba", phone: "600000000" })
    .returning();

  // Lunes 2 de noviembre de 2026 (en Canarias es UTC+0, hora de invierno)
  await db.insert(appointment).values({
    clientId: clienta.id,
    serviceId: lam.id,
    staffId: ana.id,
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
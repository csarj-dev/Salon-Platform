import "dotenv/config";
import { db } from "./index";
import { slugify } from "../lib/slug";
import {
  location, locationHours, locationService, service, serviceCategory,
  serviceCategoryTranslation, serviceTranslation, staff, staffService,
  client, appointment, schedule, timeOff, photo, staffTranslation
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

// Lo mismo para el horario de apertura de un local
function opening(locationId: number, days: number[], shifts: Shift[]) {
  return days.flatMap((weekday) =>
    shifts.map(([openTime, closeTime]) => ({
      locationId, weekday, openTime, closeTime,
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
  await db.delete(serviceTranslation);
  await db.delete(service);
  await db.delete(serviceCategoryTranslation);
  await db.delete(serviceCategory);
  await db.delete(locationHours);
  await db.delete(location);
  await db.delete(photo);

  const [centro, sur] = await db
    .insert(location)
    .values([
      {
        name: "The Room Centro",
        slug: slugify("The Room Centro"),
        address: "Dirección de ejemplo 1",
        mapsUrl: "https://www.google.com/maps/search/?api=1&query=Adeje+Tenerife",
      },
      {
        name: "The Room Sur",
        slug: slugify("The Room Sur"),
        address: "Dirección de ejemplo 2",
        mapsUrl: "https://www.google.com/maps/search/?api=1&query=Costa+Adeje+Tenerife",
      },
    ])
    .returning();

  // Horarios de EJEMPLO: se cambian cuando tengamos los reales
  await db.insert(locationHours).values([
    ...opening(centro.id, [1, 2, 3, 4, 5], [["09:00", "19:30"]]),
    ...opening(centro.id, [6], [["09:00", "17:00"]]),
    ...opening(sur.id, [1, 2, 3, 4, 5], [["10:00", "14:00"], ["16:00", "20:00"]]),
    ...opening(sur.id, [6], [["10:00", "14:00"]]),
  ]);

  const [cejas, pestanas, micro] = await db
    .insert(serviceCategory)
    .values([
      { name: "Cejas", sortOrder: 1 },
      { name: "Pestañas", sortOrder: 2 },
      { name: "Micropigmentación", sortOrder: 3 },
    ])
    .returning();

  await db.insert(serviceCategoryTranslation).values([
    { categoryId: cejas.id, locale: "es", name: "Cejas" },
    { categoryId: cejas.id, locale: "en", name: "Brows" },
    { categoryId: pestanas.id, locale: "es", name: "Pestañas" },
    { categoryId: pestanas.id, locale: "en", name: "Lashes" },
    { categoryId: micro.id, locale: "es", name: "Micropigmentación" },
    { categoryId: micro.id, locale: "en", name: "Micropigmentation" },
  ]);

  const [lam, dis, lif, mb] = await db
    .insert(service)
    .values([
            { name: "Laminado de cejas", slug: slugify("Laminado de cejas"), durationMin: 60, priceCents: 4500, categoryId: cejas.id, sortOrder: 1, featured: true },
      { name: "Diseño de cejas", slug: slugify("Diseño de cejas"), durationMin: 30, priceCents: 1800, categoryId: cejas.id, sortOrder: 2 },
      { name: "Lifting de pestañas", slug: slugify("Lifting de pestañas"), durationMin: 75, priceCents: 5500, categoryId: pestanas.id, sortOrder: 1, featured: true, depositCents: 1500 },
      // Se reserva hablando antes: no tiene profesionales asignadas a propósito
      { name: "Microblading", slug: slugify("Microblading"), durationMin: 150, priceCents: 25000, categoryId: micro.id, sortOrder: 1, requiresConsultation: true, featured: true },
    ])
    .returning();

  await db.insert(serviceTranslation).values([
        { serviceId: lam.id, locale: "es", name: "Laminado de cejas", description: "Cejas peinadas y con volumen durante semanas.", longDescription: "Texto de ejemplo: en qué consiste el tratamiento.\n\nTexto de ejemplo: cuidados posteriores y duración del resultado." },
    { serviceId: lam.id, locale: "en", name: "Brow lamination", description: "Brushed-up, fuller-looking brows for weeks.", longDescription: "Sample text: what the treatment involves.\n\nSample text: aftercare and how long the result lasts." },
    { serviceId: dis.id, locale: "es", name: "Diseño de cejas", description: "Forma y perfilado a medida de tu rostro." },
    { serviceId: dis.id, locale: "en", name: "Brow shaping", description: "Shape and definition tailored to your face." },
    { serviceId: lif.id, locale: "es", name: "Lifting de pestañas", description: "Curvatura y mirada abierta sin extensiones." },
    { serviceId: lif.id, locale: "en", name: "Lash lift", description: "A natural curl and an open look, no extensions." },
    { serviceId: mb.id, locale: "es", name: "Microblading", description: "Cejas pelo a pelo, con una consulta previa para diseñar la forma." },
    { serviceId: mb.id, locale: "en", name: "Microblading", description: "Hair-stroke brows, with a prior consultation to design the shape." },
  ]);

  const [ana, lucia, marta] = await db
    .insert(staff)
    .values([
      { name: "Ana", listedOnTeamAt: new Date() },
      { name: "Lucía", listedOnTeamAt: new Date() },
      { name: "Marta" }, // sin publicar: no aparece en la página del equipo
    ])
    .returning();

  // Cargo y presentación de EJEMPLO: se cambian por los reales
  await db.insert(staffTranslation).values([
    { staffId: ana.id, locale: "es", role: "Especialista en cejas", bio: "Texto de ejemplo: presentación de la profesional." },
    { staffId: ana.id, locale: "en", role: "Brow specialist", bio: "Sample text: the professional's introduction." },
    { staffId: lucia.id, locale: "es", role: "Especialista en pestañas", bio: "Texto de ejemplo: presentación de la profesional." },
    { staffId: lucia.id, locale: "en", role: "Lash specialist", bio: "Sample text: the professional's introduction." },
  ]);

  // Centro ofrece todo; Sur no ofrece el lifting
  await db.insert(locationService).values([
    { locationId: centro.id, serviceId: lam.id },
    { locationId: centro.id, serviceId: dis.id },
    { locationId: centro.id, serviceId: lif.id },
    { locationId: centro.id, serviceId: mb.id },
    { locationId: sur.id, serviceId: lam.id },
    { locationId: sur.id, serviceId: dis.id },
    { locationId: sur.id, serviceId: mb.id },
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
    ...weekly(ana.id, centro.id, [1, 2], [["10:00", "14:00"], ["16:00", "20:00"]]),
    ...weekly(ana.id, sur.id, [3, 4, 5], [["10:00", "14:00"], ["16:00", "20:00"]]),
    ...weekly(lucia.id, centro.id, [1, 2, 3, 4, 5, 6], [["09:00", "15:00"]]),
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
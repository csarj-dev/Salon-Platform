import "./test-env"; // tiene que ser el primer import
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { DateTime } from "luxon";
import { db, pgClient } from "../db";
import {
  appointment, client, location, locationService, schedule,
  service, staff, staffService, timeOff,
} from "../db/schema";
import { getAvailabilityForRange } from "../lib/availability-range";
import { getAvailabilityForService, type ServiceAvailability } from "../lib/availability-service";

const opts = { zone: "Atlantic/Canary", stepMin: 30, bufferMin: 0, minNoticeHours: 2 };
const NOW = new Date("2026-10-19T10:00:00Z");
// En Canarias el horario de verano termina el domingo 25 de octubre de 2026: el rango lo cruza
const FROM = "2026-10-19";
const TO = "2026-12-20";

let loc: number;
let other: number;
let svc: number;
let notOffered: number;
let a: number;
let b: number;
let inactive: number;

const utc = (iso: string) => new Date(iso);

async function wipe() {
  await db.delete(appointment);
  await db.delete(timeOff);
  await db.delete(schedule);
  await db.delete(locationService);
  await db.delete(staffService);
  await db.delete(client);
  await db.delete(staff);
  await db.delete(service);
  await db.delete(location);
}

// Forma comparable: lo que ve la pantalla, sin objetos Date
const plain = (r: ServiceAvailability) => ({
  perStaff: r.perStaff.map((s) => ({ id: s.staffId, name: s.staffName, slots: s.slots.map((d) => d.getTime()) })),
  any: r.any.map((s) => ({ at: s.startsAt.getTime(), staff: s.staffIds })),
});

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await wipe();

  const [l, m] = await db.insert(location).values([{ name: "Local" }, { name: "Otro local" }]).returning();
  loc = l.id;
  other = m.id;

  const [s1, s2] = await db
    .insert(service)
    .values([
      { name: "Servicio", durationMin: 60, priceCents: 4500 },
      { name: "Servicio que este local no ofrece", durationMin: 60, priceCents: 4500 },
    ])
    .returning();
  svc = s1.id;
  notOffered = s2.id;

  const [sa, sb, sc] = await db
    .insert(staff)
    .values([{ name: "Ana" }, { name: "Berta" }, { name: "Carla", active: false }])
    .returning();
  a = sa.id;
  b = sb.id;
  inactive = sc.id;

  await db.insert(locationService).values([
    { locationId: loc, serviceId: svc },
    { locationId: other, serviceId: svc },
    { locationId: other, serviceId: notOffered },
  ]);
  await db.insert(staffService).values([a, b, inactive].map((staffId) => ({ staffId, serviceId: svc })));

  const shift = (staffId: number, locationId: number, weekday: number, startTime: string, endTime: string) => ({
    staffId, locationId, weekday, startTime, endTime,
  });
  await db.insert(schedule).values([
    shift(a, loc, 1, "10:00", "14:00"), // lunes
    shift(a, loc, 3, "10:00", "12:00"), // miércoles, turno partido
    shift(a, loc, 3, "16:00", "18:00"),
    shift(a, loc, 5, "09:00", "13:00"), // viernes
    shift(a, loc, 7, "10:00", "12:00"), // domingo (el 25 de octubre cambia la hora)
    shift(b, loc, 1, "12:00", "16:00"),
    shift(b, loc, 2, "10:00", "14:00"), // martes
    shift(b, loc, 3, "10:00", "12:00"),
    shift(b, loc, 6, "10:00", "12:00"), // sábado
    shift(b, other, 4, "10:00", "14:00"), // jueves, en el otro local: no debe salir
    shift(inactive, loc, 1, "10:00", "14:00"), // inactiva: no debe salir
  ]);

  const [c] = await db.insert(client).values({ name: "Clienta", phone: "600111222" }).returning();
  const booking = (
    staffId: number,
    locationId: number,
    startsAt: string,
    endsAt: string,
    extra: Partial<typeof appointment.$inferInsert> = {},
  ) => ({
    clientId: c.id,
    serviceId: svc,
    staffId,
    locationId,
    startsAt: utc(startsAt),
    endsAt: utc(endsAt),
    priceAppliedCents: 4500,
    source: "web" as const,
    ...extra,
  });

  await db.insert(appointment).values([
    booking(a, loc, "2026-11-02T10:00:00Z", "2026-11-02T11:00:00Z"), // ocupa
    booking(a, loc, "2026-11-02T11:30:00Z", "2026-11-02T12:30:00Z", { status: "cancelled" }), // no ocupa
    booking(b, loc, "2026-11-03T10:00:00Z", "2026-11-03T12:00:00Z", { status: "expired" }), // no ocupa
    booking(b, loc, "2026-11-03T12:00:00Z", "2026-11-03T13:00:00Z", {
      status: "pending_deposit", depositCents: 1500, depositDueAt: utc("2026-10-19T09:00:00Z"), // plazo vencido: no ocupa
    }),
    booking(b, loc, "2026-11-04T10:00:00Z", "2026-11-04T11:00:00Z", {
      status: "pending_deposit", depositCents: 1500, depositDueAt: utc("2026-10-20T10:00:00Z"), // dentro de plazo: ocupa
    }),
    booking(a, other, "2026-11-06T09:00:00Z", "2026-11-06T11:00:00Z"), // en otro local, ocupa a Ana
  ]);

  await db.insert(timeOff).values([
    { staffId: a, startsAt: utc("2026-11-11T00:00:00Z"), endsAt: utc("2026-11-12T00:00:00Z") },
    { staffId: b, startsAt: utc("2026-11-07T10:00:00Z"), endsAt: utc("2026-11-07T11:00:00Z") },
  ]);
}, 30_000);

afterAll(async () => {
  await wipe();
  await pgClient.end();
});

describe("getAvailabilityForRange", () => {
  it("da el mismo resultado que pedir los huecos día a día", async () => {
    const range = await getAvailabilityForRange(loc, svc, FROM, TO, opts, NOW);

    let day = DateTime.fromISO(FROM, { zone: opts.zone });
    let withSlots = 0;
    for (; day.toFormat("yyyy-MM-dd") <= TO; day = day.plus({ days: 1 })) {
      const iso = day.toFormat("yyyy-MM-dd");
      const single = await getAvailabilityForService(loc, svc, iso, opts, NOW);
      const fromRange = range.get(iso);

      if (single.perStaff.length === 0) {
        expect(fromRange, `día ${iso}`).toBeUndefined();
      } else {
        withSlots++;
        expect(fromRange === undefined ? undefined : plain(fromRange), `día ${iso}`).toEqual(plain(single));
      }
    }
    // El escenario tiene que ser lo bastante rico para que la comparación signifique algo
    expect(withSlots).toBeGreaterThan(30);
  }, 60_000);

  it("las citas, ausencias, caducadas y el otro local afectan como deben", async () => {
    const range = await getAvailabilityForRange(loc, svc, FROM, TO, opts, NOW);
    const slotsOf = (iso: string, staffId: number) =>
      (range.get(iso)?.perStaff.find((s) => s.staffId === staffId)?.slots ?? []).map((d) =>
        d.toISOString().slice(11, 16),
      );

    // Ana el lunes 2: su cita de las 10:00 ocupa; la cancelada de las 11:30 no
    expect(slotsOf("2026-11-02", a)).toEqual(["11:00", "11:30", "12:00", "12:30", "13:00"]);
    // Berta el martes 3: ni la caducada ni la pendiente vencida ocupan
    expect(slotsOf("2026-11-03", b)).toEqual(["10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00"]);
    // Berta el miércoles 4: la pendiente dentro de plazo ocupa las 10:00-11:00
    expect(slotsOf("2026-11-04", b)).toEqual(["11:00"]);
    // Ana el viernes 6: su cita en el otro local de 9:00 a 11:00 la ocupa
    expect(slotsOf("2026-11-06", a)).toEqual(["11:00", "11:30", "12:00"]);
    // Berta el sábado 7: tiene una ausencia de 10:00 a 11:00
    expect(slotsOf("2026-11-07", b)).toEqual(["11:00"]);
    // Ana el miércoles 11: ausencia de todo el día
    expect(range.get("2026-11-11")?.perStaff.find((s) => s.staffId === a)).toBeUndefined();
  });

  it("no incluye a las profesionales inactivas ni los turnos de otro local", async () => {
    const range = await getAvailabilityForRange(loc, svc, FROM, TO, opts, NOW);
    const everyone = [...range.values()].flatMap((d) => d.perStaff.map((s) => s.staffId));
    expect(everyone).not.toContain(inactive);
    // Berta trabaja los jueves solo en el otro local: ningún jueves sale en este
    for (const iso of range.keys()) {
      expect(DateTime.fromISO(iso, { zone: opts.zone }).weekday).not.toBe(4);
    }
  });

  it("respeta la antelación mínima del primer día", async () => {
    // Domingo 25 de octubre 10:00-12:00 local; con NOW dos días antes no afecta, pero
    // pidiendo desde un NOW muy cercano, solo quedan los huecos con 2 h de margen
    const soon = new Date("2026-11-02T09:00:00Z"); // lunes 9:00
    const range = await getAvailabilityForRange(loc, svc, "2026-11-02", "2026-11-02", opts, soon);
    const times = range.get("2026-11-02")?.perStaff.find((s) => s.staffId === a)?.slots ?? [];
    expect(times.map((d) => d.toISOString().slice(11, 16))).toEqual(["11:00", "11:30", "12:00", "12:30", "13:00"]);
  });

  it("un servicio que el local no ofrece, o un rango al revés, da un mapa vacío", async () => {
    expect((await getAvailabilityForRange(loc, notOffered, FROM, TO, opts, NOW)).size).toBe(0);
    expect((await getAvailabilityForRange(loc, svc, TO, FROM, opts, NOW)).size).toBe(0);
    expect((await getAvailabilityForRange(loc, 999_999, FROM, TO, opts, NOW)).size).toBe(0);
  });

  it("un rango de un solo día funciona", async () => {
    const range = await getAvailabilityForRange(loc, svc, "2026-11-09", "2026-11-09", opts, NOW);
    const single = await getAvailabilityForService(loc, svc, "2026-11-09", opts, NOW);
    expect(plain(range.get("2026-11-09")!)).toEqual(plain(single));
    expect([...range.keys()]).toEqual(["2026-11-09"]);
  });
});
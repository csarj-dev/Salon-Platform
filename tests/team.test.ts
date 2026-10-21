import "./test-env"; // tiene que ser el primer import
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, pgClient } from "../db";
import { location, schedule, staff, staffTranslation } from "../db/schema";
import { hasListedTeam, listTeam } from "../lib/catalog";

const NAME = "Team test";

let locA: number;
let locB: number;
let listedA: number; // publicada, trabaja en A y B, con traducciones
let notListed: number; // activa pero sin publicar
let inactive: number; // publicada pero inactiva
let listedD: number; // publicada, solo en B, sin traducciones

async function cleanup() {
  const rows = await db.select({ id: staff.id }).from(staff).where(eq(staff.name, NAME));
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    await db.delete(schedule).where(inArray(schedule.staffId, ids));
    await db.delete(staff).where(inArray(staff.id, ids)); // las traducciones caen en cascada
  }
  await db.delete(location).where(like(location.name, "Team test%"));
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await cleanup();

  const [a, b] = await db
    .insert(location)
    .values([
      { name: "Team test A", slug: "team-test-a" },
      { name: "Team test B", slug: "team-test-b" },
    ])
    .returning();
  locA = a.id;
  locB = b.id;

  const [sa, sb, sc, sd] = await db
    .insert(staff)
    .values([
      { name: NAME, listedOnTeamAt: new Date("2026-01-01T00:00:00Z") },
      { name: NAME },
      { name: NAME, active: false, listedOnTeamAt: new Date("2026-01-15T00:00:00Z") },
      { name: NAME, listedOnTeamAt: new Date("2026-02-01T00:00:00Z") },
    ])
    .returning();
  listedA = sa.id;
  notListed = sb.id;
  inactive = sc.id;
  listedD = sd.id;

  await db.insert(staffTranslation).values([
    { staffId: listedA, locale: "es", role: "Cejas", bio: "Bio A" },
    { staffId: listedA, locale: "en", role: "Brows", bio: null },
  ]);

  const shift = { weekday: 1, startTime: "10:00", endTime: "14:00" };
  await db.insert(schedule).values([
    { staffId: listedA, locationId: locA, ...shift },
    { staffId: listedA, locationId: locB, ...shift },
    { staffId: notListed, locationId: locA, ...shift },
    { staffId: inactive, locationId: locA, ...shift },
    { staffId: listedD, locationId: locB, ...shift },
  ]);
}, 30_000);

afterAll(async () => {
  await cleanup();
  await pgClient.end();
});

const mine = [() => listedA, () => notListed, () => inactive, () => listedD];
const onlyMine = <T extends { id: number }>(list: T[]) =>
  list.filter((m) => mine.some((id) => id() === m.id));

describe("equipo", () => {
  it("lista solo a las activas y publicadas, en el orden de publicación", async () => {
    const team = onlyMine(await listTeam("es", "es"));
    expect(team.map((m) => m.id)).toEqual([listedA, listedD]);
  });

  it("cargo y bio salen en el idioma pedido", async () => {
    const es = onlyMine(await listTeam("es", "es")).find((m) => m.id === listedA);
    const en = onlyMine(await listTeam("en", "es")).find((m) => m.id === listedA);
    expect(es).toMatchObject({ role: "Cejas", bio: "Bio A" });
    expect(en).toMatchObject({ role: "Brows", bio: null });
  });

  it("si falta el idioma pedido usa el idioma por defecto", async () => {
    const fr = onlyMine(await listTeam("fr", "es")).find((m) => m.id === listedA);
    expect(fr).toMatchObject({ role: "Cejas", bio: "Bio A" });
  });

  it("sin traducciones, cargo y bio son null", async () => {
    const d = onlyMine(await listTeam("es", "es")).find((m) => m.id === listedD);
    expect(d).toMatchObject({ role: null, bio: null });
  });

  it("devuelve los locales donde trabaja cada una, por nombre", async () => {
    const a = onlyMine(await listTeam("es", "es")).find((m) => m.id === listedA);
    expect(a?.locations.map((l) => l.id)).toEqual([locA, locB]);
    expect(a?.locations[0].slug).toBe("team-test-a");
  });

  it("con locationId solo salen las que trabajan en ese local", async () => {
    const inA = onlyMine(await listTeam("es", "es", { locationId: locA }));
    const inB = onlyMine(await listTeam("es", "es", { locationId: locB }));
    expect(inA.map((m) => m.id)).toEqual([listedA]);
    expect(inB.map((m) => m.id)).toEqual([listedA, listedD]);
  });

  it("hasListedTeam es verdadero si hay alguien publicado", async () => {
    expect(await hasListedTeam()).toBe(true);
  });
});
import "./test-env"; // tiene que ser el primer import
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { inArray } from "drizzle-orm";
import { db, pgClient } from "../db";
import { session, user } from "../db/schema";
import { latestDate, listPanelUsers } from "../lib/user-db";

const NEVER = "test-users-never";
const ACTIVE = "test-users-active";
const LOGGED_OUT = "test-users-logged-out";
const IDS = [NEVER, ACTIVE, LOGGED_OUT];

async function cleanUp() {
  // Las sesiones se borran solas (onDelete: cascade)
  await db.delete(user).where(inArray(user.id, IDS));
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await cleanUp();

  await db.insert(user).values([
    { id: NEVER, name: "Nunca entró", email: "never.users@example.com", role: "reception" },
    {
      id: ACTIVE, name: "Con sesión", email: "active.users@example.com", role: "owner",
      lastLoginAt: new Date("2026-11-01T09:00:00Z"),
    },
    {
      id: LOGGED_OUT, name: "Cerró sesión", email: "loggedout.users@example.com", role: "reception",
      lastLoginAt: new Date("2026-11-05T09:00:00Z"),
    },
  ]);

  // ACTIVE tiene dos sesiones: cuenta la más reciente, que es posterior a su lastLoginAt
  const expiresAt = new Date("2026-12-31T00:00:00Z");
  await db.insert(session).values([
    { id: "test-users-s1", token: "test-users-t1", userId: ACTIVE, expiresAt, updatedAt: new Date("2026-11-03T10:00:00Z") },
    { id: "test-users-s2", token: "test-users-t2", userId: ACTIVE, expiresAt, updatedAt: new Date("2026-11-10T18:30:00Z") },
  ]);
});

afterAll(async () => {
  await cleanUp();
  await pgClient.end();
});

describe("listPanelUsers", () => {
  it("da el último acceso combinando inicio de sesión y sesiones vivas", async () => {
    const mine = (await listPanelUsers()).filter((u) => IDS.includes(u.id));
    const byId = Object.fromEntries(mine.map((u) => [u.id, u]));

    expect(byId[NEVER].lastSeenAt).toBeNull();
    expect(byId[ACTIVE].lastSeenAt?.toISOString()).toBe("2026-11-10T18:30:00.000Z");
    // Sin sesión (cerró sesión): queda lastLoginAt
    expect(byId[LOGGED_OUT].lastSeenAt?.toISOString()).toBe("2026-11-05T09:00:00.000Z");
    expect(byId[ACTIVE].banned).toBe(false);
  });
});

describe("latestDate", () => {
  it("ignora nulos y se queda con la más reciente", () => {
    const a = new Date("2026-01-01");
    const b = new Date("2026-02-01");
    expect(latestDate(null, null)).toBeNull();
    expect(latestDate(a, null, b)).toBe(b);
  });
});
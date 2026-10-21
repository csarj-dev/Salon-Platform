import "./test-env"; // tiene que ser el primer import
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, pgClient } from "../db";
import { location, locationHours, locationPhoto, photo } from "../db/schema";
import { getLocationBySlug, listLocationGalleryPhotoIds } from "../lib/catalog";

const SLUG = "location-detail-test";
const SLUG_OFF = "location-detail-off";
const KEY_PREFIX = "salons/test/detail";

let locationId: number;
let coverId: number;
let p1: number;
let p2: number;
let p3: number;

async function cleanup() {
  await db.delete(location).where(inArray(location.slug, [SLUG, SLUG_OFF]));
  await db.delete(photo).where(like(photo.storageKey, `${KEY_PREFIX}/%`));
}

async function newPhoto(n: number) {
  const [p] = await db
    .insert(photo)
    .values({ storageKey: `${KEY_PREFIX}/p${n}.jpg`, width: 100, height: 100 })
    .returning();
  return p.id;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await cleanup();

  coverId = await newPhoto(0);
  p1 = await newPhoto(1);
  p2 = await newPhoto(2);
  p3 = await newPhoto(3);

  const [loc] = await db
    .insert(location)
    .values({ name: "Location detail test", slug: SLUG, photoId: coverId, address: "Calle 1" })
    .returning();
  locationId = loc.id;

  await db.insert(location).values({ name: "Location detail off", slug: SLUG_OFF, active: false });

  await db.insert(locationHours).values([
    { locationId, weekday: 1, openTime: "16:00", closeTime: "20:00" },
    { locationId, weekday: 1, openTime: "09:00", closeTime: "14:00" },
  ]);

  // Orden pedido: p3, p1, p2
  await db.insert(locationPhoto).values([
    { locationId, photoId: p1, sortOrder: 2 },
    { locationId, photoId: p2, sortOrder: 3 },
    { locationId, photoId: p3, sortOrder: 1 },
  ]);
}, 30_000);

afterAll(async () => {
  await cleanup();
  await pgClient.end();
});

describe("local por slug", () => {
  it("encuentra el local con su portada y su horario ordenado", async () => {
    const r = await getLocationBySlug(SLUG);
    expect(r).toMatchObject({ id: locationId, name: "Location detail test", photoId: coverId, address: "Calle 1" });
    expect(r?.hours).toHaveLength(2);
    expect(r?.hours[0].openTime.startsWith("09:00")).toBe(true);
    expect(r?.hours[1].openTime.startsWith("16:00")).toBe(true);
  });

  it("devuelve null si el slug no existe", async () => {
    expect(await getLocationBySlug("no-existe-este-local")).toBeNull();
  });

  it("devuelve null si el local está inactivo", async () => {
    expect(await getLocationBySlug(SLUG_OFF)).toBeNull();
  });

  it("la base rechaza dos locales con el mismo slug", async () => {
    await expect(
      db.insert(location).values({ name: "Duplicado", slug: SLUG }),
    ).rejects.toThrow();
  });
});

describe("galería del local", () => {
  it("devuelve los ids de las fotos en el orden elegido", async () => {
    expect(await listLocationGalleryPhotoIds(locationId)).toEqual([p3, p1, p2]);
  });

  it("un local sin galería devuelve una lista vacía", async () => {
    expect(await listLocationGalleryPhotoIds(999_999)).toEqual([]);
  });

  it("al borrar el local se borra su galería pero no las fotos", async () => {
    const [tmp] = await db
      .insert(location)
      .values({ name: "Location detail off", slug: SLUG_OFF + "-tmp" })
      .returning();
    await db.insert(locationPhoto).values({ locationId: tmp.id, photoId: p1, sortOrder: 1 });

    await db.delete(location).where(eq(location.id, tmp.id));

    expect(await listLocationGalleryPhotoIds(tmp.id)).toEqual([]);
    const [still] = await db.select().from(photo).where(eq(photo.id, p1));
    expect(still).toBeDefined();
  });
});
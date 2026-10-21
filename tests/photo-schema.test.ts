import "./test-env"; // tiene que ser el primer import
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, pgClient } from "../db";
import { location, photo, photoTranslation } from "../db/schema";
import { getPhotoViews } from "../lib/photos";
import { getStorage } from "../lib/storage";

const KEY = "salons/test/location/photo-test-1";
const KEY_B = "salons/test/location/photo-test-2";
const keys = [`${KEY}.jpg`, `${KEY_B}.jpg`];

let photoId: number;
let locationId: number;

async function cleanup() {
  await db.delete(location).where(eq(location.name, "Photo test"));
  await db.delete(photo).where(inArray(photo.storageKey, keys));
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await cleanup();

  const [p] = await db
    .insert(photo)
    .values({ storageKey: keys[0], width: 1200, height: 800 })
    .returning();
  photoId = p.id;

  await db.insert(photoTranslation).values([
    { photoId, locale: "es", alt: "Fachada del local" },
    { photoId, locale: "en", alt: "Storefront" },
  ]);

  const [l] = await db.insert(location).values({ name: "Photo test", photoId }).returning();
  locationId = l.id;
}, 30_000);

afterAll(async () => {
  await cleanup();
  await pgClient.end();
});

describe("fotos", () => {
  it("devuelve url, medidas y alt en el idioma pedido", async () => {
    const storage = await getStorage();
    const es = (await getPhotoViews([photoId], "es", "es")).get(photoId);
    const en = (await getPhotoViews([photoId], "en", "es")).get(photoId);

    expect(es).toMatchObject({ width: 1200, height: 800, alt: "Fachada del local" });
    expect(es?.src).toBe(storage.publicUrl(keys[0]));
    expect(en?.alt).toBe("Storefront");
  });

  it("usa el alt del idioma por defecto si falta el pedido", async () => {
    const fr = (await getPhotoViews([photoId], "fr", "es")).get(photoId);
    expect(fr?.alt).toBe("Fachada del local");
  });

  it("ignora ids nulos o inexistentes", async () => {
    expect((await getPhotoViews([null, 999_999], "es", "es")).size).toBe(0);
  });

  it("al borrar la foto el local se queda sin foto, no se borra", async () => {
    const [p] = await db
      .insert(photo)
      .values({ storageKey: keys[1], width: 100, height: 100 })
      .returning();
    await db.update(location).set({ photoId: p.id }).where(eq(location.id, locationId));

    await db.delete(photo).where(eq(photo.id, p.id));

    const [l] = await db.select().from(location).where(eq(location.id, locationId));
    expect(l).toBeDefined();
    expect(l.photoId).toBeNull();
  });

  it("la base rechaza un alt en blanco", async () => {
    await expect(
      db.insert(photoTranslation).values({ photoId, locale: "fr", alt: "   " }),
    ).rejects.toThrow();
  });

  it("la base rechaza dos fotos con la misma clave", async () => {
    await expect(
      db.insert(photo).values({ storageKey: keys[0], width: 10, height: 10 }),
    ).rejects.toThrow();
  });
});
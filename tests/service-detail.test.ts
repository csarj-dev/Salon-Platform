import "./test-env"; // tiene que ser el primer import
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, pgClient } from "../db";
import {
  location, locationService, photo, service, servicePhoto, serviceTranslation,
} from "../db/schema";
import { getServiceBySlug, listFeaturedServices, listServicesForLocation } from "../lib/catalog";

const NAME = "Service detail test";
const KEY_PREFIX = "salons/test/service-detail";
const slugOf = (n: number) => `service-detail-test-${n}`;

let locA: number;
let locB: number; // inactivo
let s1: number; // slug + texto largo + galería + foto + precio propio en A
let s2: number; // slug, sin contenido
let s3: number; // contenido pero sin slug
let s4: number; // slug + solo galería
let s5: number; // contenido pero solo en un local inactivo
let cover: number;
let g1: number;
let g2: number;

async function cleanup() {
  const svcs = await db.select({ id: service.id }).from(service).where(like(service.name, `${NAME}%`));
  const ids = svcs.map((s) => s.id);
  if (ids.length) {
    await db.delete(locationService).where(inArray(locationService.serviceId, ids));
    await db.delete(service).where(inArray(service.id, ids)); // traducciones y galería caen en cascada
  }
  await db.delete(location).where(like(location.name, `${NAME}%`));
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

  cover = await newPhoto(0);
  g1 = await newPhoto(1);
  g2 = await newPhoto(2);

  const [a, b] = await db
    .insert(location)
    .values([
      { name: `${NAME} A`, slug: "service-detail-test-loc-a" },
      { name: `${NAME} B`, slug: "service-detail-test-loc-b", active: false },
    ])
    .returning();
  locA = a.id;
  locB = b.id;

  const base = { durationMin: 60, priceCents: 4500 };
  const [r1, r2, r3, r4, r5] = await db
    .insert(service)
    .values([
      { name: `${NAME} 1`, slug: slugOf(1), photoId: cover, featured: true, ...base },
      { name: `${NAME} 2`, slug: slugOf(2), featured: true, ...base },
      { name: `${NAME} 3`, ...base },
      { name: `${NAME} 4`, slug: slugOf(4), ...base },
      { name: `${NAME} 5`, slug: slugOf(5), ...base },
    ])
    .returning();
  s1 = r1.id; s2 = r2.id; s3 = r3.id; s4 = r4.id; s5 = r5.id;

  await db.insert(serviceTranslation).values([
    { serviceId: s1, locale: "es", name: "Servicio uno", description: "Corta", longDescription: "Texto largo\n\nSegundo párrafo" },
    { serviceId: s1, locale: "en", name: "Service one", description: "Short", longDescription: null },
    { serviceId: s2, locale: "es", name: "Servicio dos" },
    { serviceId: s3, locale: "es", name: "Servicio tres", longDescription: "Con texto pero sin slug" },
    { serviceId: s4, locale: "es", name: "Servicio cuatro" },
    { serviceId: s5, locale: "es", name: "Servicio cinco", longDescription: "Solo en un local inactivo" },
  ]);

  // s1: orden pedido g2, g1
  await db.insert(servicePhoto).values([
    { serviceId: s1, photoId: g1, sortOrder: 2 },
    { serviceId: s1, photoId: g2, sortOrder: 1 },
    { serviceId: s4, photoId: g1, sortOrder: 1 },
  ]);

  await db.insert(locationService).values([
    { locationId: locA, serviceId: s1, priceCents: 4000 },
    { locationId: locB, serviceId: s1 },
    { locationId: locA, serviceId: s2 },
    { locationId: locA, serviceId: s3 },
    { locationId: locA, serviceId: s4 },
    { locationId: locB, serviceId: s5 },
  ]);
}, 30_000);

afterAll(async () => {
  await cleanup();
  await pgClient.end();
});

describe("servicios con contenido en la lista", () => {
  it("marca hasDetail solo si hay slug y (texto largo o galería)", async () => {
    const list = await listServicesForLocation(locA, "es", "es");
    const flag = (id: number) => list.find((s) => s.id === id)?.hasDetail;
    expect(flag(s1)).toBe(true);
    expect(flag(s2)).toBe(false); // sin contenido
    expect(flag(s3)).toBe(false); // sin slug
    expect(flag(s4)).toBe(true); // solo galería
  });

  it("incluye el slug y la foto de cada servicio", async () => {
    const list = await listServicesForLocation(locA, "es", "es");
    const one = list.find((s) => s.id === s1);
    expect(one).toMatchObject({ slug: slugOf(1), photoId: cover });
  });

  it("los destacados también traen hasDetail, slug y foto", async () => {
    const featured = await listFeaturedServices("es", "es", 100);
    expect(featured.find((s) => s.id === s1)).toMatchObject({ hasDetail: true, slug: slugOf(1), photoId: cover });
    expect(featured.find((s) => s.id === s2)).toMatchObject({ hasDetail: false });
  });
});

describe("servicio por slug", () => {
  it("devuelve el contenido, la galería ordenada y el precio de cada local activo", async () => {
    const d = await getServiceBySlug(slugOf(1), "es", "es");
    expect(d).toMatchObject({
      id: s1,
      name: "Servicio uno",
      description: "Corta",
      longDescription: "Texto largo\n\nSegundo párrafo",
      photoId: cover,
      galleryPhotoIds: [g2, g1],
    });
    // El local B está inactivo: no sale. El A tiene precio propio.
    expect(d?.offers).toHaveLength(1);
    expect(d?.offers[0]).toMatchObject({ durationMin: 60, priceCents: 4000 });
    expect(d?.offers[0].location.id).toBe(locA);
  });

  it("en un idioma sin texto largo usa el del idioma por defecto", async () => {
    const d = await getServiceBySlug(slugOf(1), "en", "es");
    expect(d?.name).toBe("Service one");
    expect(d?.longDescription).toBe("Texto largo\n\nSegundo párrafo");
  });

  it("solo con galería también tiene página", async () => {
    const d = await getServiceBySlug(slugOf(4), "es", "es");
    expect(d).not.toBeNull();
    expect(d?.longDescription).toBeNull();
    expect(d?.galleryPhotoIds).toEqual([g1]);
  });

  it("sin contenido, sin ofrecerse en un local activo o con slug inexistente devuelve null", async () => {
    expect(await getServiceBySlug(slugOf(2), "es", "es")).toBeNull(); // sin contenido
    expect(await getServiceBySlug(slugOf(5), "es", "es")).toBeNull(); // solo en local inactivo
    expect(await getServiceBySlug("no-existe-este-servicio", "es", "es")).toBeNull();
  });
});

describe("restricciones", () => {
  it("la base rechaza dos servicios con el mismo slug", async () => {
    await expect(
      db.insert(service).values({ name: `${NAME} dup`, slug: slugOf(1), durationMin: 10, priceCents: 100 }),
    ).rejects.toThrow();
  });

  it("al borrar un servicio se borra su galería pero no las fotos", async () => {
    const [tmp] = await db
      .insert(service)
      .values({ name: `${NAME} tmp`, slug: slugOf(9), durationMin: 10, priceCents: 100 })
      .returning();
    await db.insert(servicePhoto).values({ serviceId: tmp.id, photoId: g1, sortOrder: 1 });

    await db.delete(service).where(eq(service.id, tmp.id));

    const rows = await db.select().from(servicePhoto).where(eq(servicePhoto.serviceId, tmp.id));
    expect(rows).toEqual([]);
    const [still] = await db.select().from(photo).where(eq(photo.id, g1));
    expect(still).toBeDefined();
  });
});
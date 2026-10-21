import "./test-env"; // tiene que ser el primer import
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, pgClient } from "../db";
import {
  location, locationService, photo, schedule, service, staff, staffService,
} from "../db/schema";
import { listActiveLocations, listServicesForLocation, listStaffForService } from "../lib/catalog";

const NAME = "Catalog photo test";
const KEY_PREFIX = "salons/test/catalog";

let locationId: number;
let serviceWithPhoto: number;
let serviceWithoutPhoto: number;
let staffWithPhoto: number;
let staffWithoutPhoto: number;
let locationPhotoId: number;
let servicePhotoId: number;
let staffPhotoId: number;

async function cleanup() {
  const locs = await db.select({ id: location.id }).from(location).where(eq(location.name, NAME));
  const svcs = await db.select({ id: service.id }).from(service).where(eq(service.name, NAME));
  const stfs = await db.select({ id: staff.id }).from(staff).where(eq(staff.name, NAME));
  const locIds = locs.map((l) => l.id);
  const svcIds = svcs.map((s) => s.id);
  const stfIds = stfs.map((s) => s.id);

  if (stfIds.length) {
    await db.delete(schedule).where(inArray(schedule.staffId, stfIds));
    await db.delete(staffService).where(inArray(staffService.staffId, stfIds));
  }
  if (locIds.length) await db.delete(locationService).where(inArray(locationService.locationId, locIds));
  if (svcIds.length) await db.delete(locationService).where(inArray(locationService.serviceId, svcIds));
  if (stfIds.length) await db.delete(staff).where(inArray(staff.id, stfIds));
  if (svcIds.length) await db.delete(service).where(inArray(service.id, svcIds));
  if (locIds.length) await db.delete(location).where(inArray(location.id, locIds));
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

  locationPhotoId = await newPhoto(1);
  servicePhotoId = await newPhoto(2);
  staffPhotoId = await newPhoto(3);

  const [loc] = await db.insert(location).values({ name: NAME, photoId: locationPhotoId }).returning();
  locationId = loc.id;

  const [s1, s2] = await db
    .insert(service)
    .values([
      { name: NAME, durationMin: 30, priceCents: 1000, photoId: servicePhotoId },
      { name: NAME, durationMin: 30, priceCents: 1000 },
    ])
    .returning();
  serviceWithPhoto = s1.id;
  serviceWithoutPhoto = s2.id;

  await db.insert(locationService).values([
    { locationId, serviceId: s1.id },
    { locationId, serviceId: s2.id },
  ]);

  const [t1, t2] = await db
    .insert(staff)
    .values([
      { name: NAME, photoId: staffPhotoId },
      { name: NAME },
    ])
    .returning();
  staffWithPhoto = t1.id;
  staffWithoutPhoto = t2.id;

  await db.insert(staffService).values([
    { staffId: t1.id, serviceId: s1.id },
    { staffId: t2.id, serviceId: s1.id },
  ]);
  await db.insert(schedule).values([
    { staffId: t1.id, locationId, weekday: 1, startTime: "10:00", endTime: "14:00" },
    { staffId: t2.id, locationId, weekday: 1, startTime: "10:00", endTime: "14:00" },
  ]);
}, 30_000);

afterAll(async () => {
  await cleanup();
  await pgClient.end();
});

describe("photoId en el catálogo", () => {
  it("los locales traen su photoId", async () => {
    const mine = (await listActiveLocations()).find((l) => l.id === locationId);
    expect(mine?.photoId).toBe(locationPhotoId);
  });

  it("los servicios traen su photoId, o null si no tienen foto", async () => {
    const list = await listServicesForLocation(locationId, "es", "es");
    expect(list.find((s) => s.id === serviceWithPhoto)?.photoId).toBe(servicePhotoId);
    expect(list.find((s) => s.id === serviceWithoutPhoto)?.photoId).toBeNull();
  });

  it("las profesionales traen su photoId, o null si no tienen foto", async () => {
    const list = await listStaffForService(locationId, serviceWithPhoto);
    expect(list.find((s) => s.id === staffWithPhoto)?.photoId).toBe(staffPhotoId);
    expect(list.find((s) => s.id === staffWithoutPhoto)?.photoId).toBeNull();
  });
});
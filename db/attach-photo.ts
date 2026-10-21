import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { imageSize } from "image-size";
import { db, pgClient } from "./index";
import { location, photo, photoTranslation, service, staff } from "./schema";
import { loadSalonConfig } from "../lib/salon-config";
import { buildPhotoKey, validatePhotoUpload, type PhotoScope } from "../lib/photo-upload";
import { missingAltLocales, parseAttachArgs, type AttachEntity } from "../lib/photo-cli";
import { getStorage } from "../lib/storage";

// Ejecutar con (npm run rompe las opciones --alt-* y las comillas en Windows):
//   npx tsx db/attach-photo.ts staff 1 "C:\ruta\foto.webp" --alt-es "Retrato de Ana" --alt-en "Portrait of Ana"

// image-size detecta el formato por el contenido del archivo, no por su extensión
const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

// Devuelve la fila de la entidad (con su foto actual) o undefined si no existe
async function findEntity(entity: AttachEntity, id: number) {
  const rows =
    entity === "location"
      ? await db.select({ photoId: location.photoId }).from(location).where(eq(location.id, id))
      : entity === "service"
        ? await db.select({ photoId: service.photoId }).from(service).where(eq(service.id, id))
        : await db.select({ photoId: staff.photoId }).from(staff).where(eq(staff.id, id));
  return rows[0];
}

async function main() {
  const args = parseAttachArgs(process.argv.slice(2));
  const config = await loadSalonConfig();

  const unknown = Object.keys(args.alt).filter((l) => !config.locales.includes(l));
  if (unknown.length > 0) {
    throw new Error(`Idioma(s) que el salón no tiene: ${unknown.join(", ")} (tiene: ${config.locales.join(", ")})`);
  }
  const missing = missingAltLocales(args.alt, config.locales);
  if (missing.length > 0) {
    throw new Error(`Falta el texto alternativo en: ${missing.map((l) => `--alt-${l}`).join(", ")}`);
  }

  const current = await findEntity(args.entity, args.id);
  if (!current) throw new Error(`No existe ${args.entity} con id ${args.id}`);

  const buffer = await readFile(args.file);
  const info = imageSize(buffer);
  const contentType = info.type ? CONTENT_TYPES[info.type] : undefined;
  if (!contentType || !info.width || !info.height) {
    throw new Error("No se reconoce la imagen (usa jpg, png o webp)");
  }
  const check = validatePhotoUpload({ contentType, size: buffer.byteLength });
  if (!check.ok) {
    throw new Error(`Archivo rechazado (${check.reason}). Máximo 8 MB, formatos jpg/png/webp.`);
  }

  const salonId = process.env.SALON_ID!;
  const key = buildPhotoKey({
    salonId,
    scope: args.entity satisfies PhotoScope,
    id: randomUUID(),
    extension: check.extension,
  });

  const storage = await getStorage();
  await storage.put(key, buffer, contentType);

  let newPhotoId: number;
  try {
    newPhotoId = await db.transaction(async (tx) => {
      const [p] = await tx
        .insert(photo)
        .values({ storageKey: key, width: info.width, height: info.height })
        .returning({ id: photo.id });

      await tx.insert(photoTranslation).values(
        Object.entries(args.alt).map(([locale, alt]) => ({ photoId: p.id, locale, alt })),
      );

      if (args.entity === "location") {
        await tx.update(location).set({ photoId: p.id }).where(eq(location.id, args.id));
      } else if (args.entity === "service") {
        await tx.update(service).set({ photoId: p.id }).where(eq(service.id, args.id));
      } else {
        await tx.update(staff).set({ photoId: p.id }).where(eq(staff.id, args.id));
      }
      return p.id;
    });
  } catch (error) {
    await storage.remove(key); // no dejar el archivo suelto si la base falló
    throw error;
  }

  // Si ya había una foto, se borra la anterior (fila y archivo)
  if (current.photoId !== null) {
    const [old] = await db.select().from(photo).where(eq(photo.id, current.photoId));
    if (old) {
      await db.delete(photo).where(eq(photo.id, old.id));
      await storage.remove(old.storageKey).catch(() => {}); // si falla, solo queda un archivo huérfano
    }
  }

  console.log(`Foto ${newPhotoId} asociada a ${args.entity} ${args.id}: ${storage.publicUrl(key)}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pgClient.end());
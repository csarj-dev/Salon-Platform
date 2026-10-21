import { and, inArray } from "drizzle-orm";
import { db } from "../db";
import { photo, photoTranslation } from "../db/schema";
import { pickTranslation } from "./pick-translation";
import { getStorage } from "./storage";

export type PhotoView = {
  id: number;
  src: string;
  width: number;
  height: number;
  alt: string;
};

// Los ids que no existen o son null se ignoran: quien llama usa map.get(id) y,
// si no hay foto, pinta el marcador gris
export async function getPhotoViews(
  ids: (number | null)[],
  locale: string,
  defaultLocale: string,
): Promise<Map<number, PhotoView>> {
  const unique = [...new Set(ids.filter((id): id is number => id !== null))];
  if (unique.length === 0) return new Map();

  const rows = await db.select().from(photo).where(inArray(photo.id, unique));
  if (rows.length === 0) return new Map();

  const alts = await db
    .select()
    .from(photoTranslation)
    .where(
      and(
        inArray(photoTranslation.photoId, unique),
        inArray(photoTranslation.locale, [...new Set([locale, defaultLocale])]),
      ),
    );

  const storage = await getStorage();

  return new Map(
    rows.map((r): [number, PhotoView] => [
      r.id,
      {
        id: r.id,
        src: storage.publicUrl(r.storageKey),
        width: r.width,
        height: r.height,
        alt: pickTranslation(
          alts
            .filter((a) => a.photoId === r.id)
            .map((a) => ({ locale: a.locale, name: a.alt, description: null })),
          locale,
          defaultLocale,
          "",
        ).name,
      },
    ]),
  );
}
export const PHOTO_SCOPES = ["hero", "gallery", "location", "service", "staff"] as const;
export type PhotoScope = (typeof PHOTO_SCOPES)[number];

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8 MB

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type UploadCheck =
  | { ok: true; extension: string }
  | { ok: false; reason: "type" | "empty" | "too_large" };

export function validatePhotoUpload(file: { contentType: string; size: number }): UploadCheck {
  const extension = EXTENSIONS[file.contentType];
  if (!extension) return { ok: false, reason: "type" };
  if (file.size <= 0) return { ok: false, reason: "empty" };
  if (file.size > MAX_PHOTO_BYTES) return { ok: false, reason: "too_large" };
  return { ok: true, extension };
}

// salons/<salón>/<ámbito>/<id>.<ext>  (cada salón en su propia carpeta)
export function buildPhotoKey(input: {
  salonId: string;
  scope: PhotoScope;
  id: string;
  extension: string;
}): string {
  const { salonId, scope, id, extension } = input;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(salonId)) throw new Error(`salonId no válido: ${salonId}`);
  if (!PHOTO_SCOPES.includes(scope)) throw new Error(`ámbito no válido: ${scope}`);
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`id no válido: ${id}`);
  if (!/^[a-z0-9]+$/.test(extension)) throw new Error(`extensión no válida: ${extension}`);
  return `salons/${salonId}/${scope}/${id}.${extension}`;
}

// Defensa contra rutas raras ("../", "/abs", "a//b") antes de tocar el disco o el bucket
export function isSafeStorageKey(key: string): boolean {
  return /^[a-z0-9-]+(\/[a-z0-9-]+)*\.[a-z0-9]+$/.test(key);
}
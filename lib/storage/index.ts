import { createLocalStorage } from "./local";
import type { Storage } from "./types";

export type { Storage } from "./types";

let cached: Promise<Storage> | undefined;

export function getStorage(): Promise<Storage> {
  cached ??= createStorage();
  return cached;
}

async function createStorage(): Promise<Storage> {
  const driver = process.env.STORAGE_DRIVER ?? "local";

  if (driver === "local") return createLocalStorage();

  if (driver === "r2") {
    const required = [
      "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "STORAGE_PUBLIC_URL",
    ] as const;
    const missing = required.filter((name) => !process.env[name]);
    if (missing.length > 0) {
      throw new Error(`Faltan variables para el almacenamiento R2: ${missing.join(", ")}`);
    }
    const { createR2Storage } = await import("./r2"); // el SDK solo se carga si se usa R2
    return createR2Storage({
      accountId: process.env.R2_ACCOUNT_ID!,
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      bucket: process.env.R2_BUCKET!,
      publicUrl: process.env.STORAGE_PUBLIC_URL!,
    });
  }

  throw new Error(`STORAGE_DRIVER desconocido: ${driver} (usa "local" o "r2")`);
}
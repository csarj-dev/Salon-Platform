import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isSafeStorageKey } from "../photo-upload";
import { joinPublicUrl } from "./public-url";
import type { Storage } from "./types";

// Solo para desarrollo: guarda en public/uploads (ignorado por git)
export function createLocalStorage(): Storage {
  const root = path.join(process.cwd(), "public", "uploads");

  function fileFor(key: string) {
    if (!isSafeStorageKey(key)) throw new Error(`Clave de almacenamiento no válida: ${key}`);
    return path.join(root, ...key.split("/"));
  }

  return {
    publicUrl: (key) => joinPublicUrl("/uploads", key),
    async put(key, body) {
      const file = fileFor(key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, body);
    },
    async remove(key) {
      await rm(fileFor(key), { force: true });
    },
  };
}
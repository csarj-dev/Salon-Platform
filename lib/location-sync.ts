// Poner los locales de la base al día con el config del salón (initialLocations):
// nombre, dirección y slug (la dirección /locations/<slug>, que también usa
// koibox.accounts.*.locations). Lógica pura de db/location-sync.ts.
import { assignSlugs, isValidSlug } from "./slug";

export type LocationRow = { id: number; name: string; address: string | null; slug: string | null };
export type ConfigLocation = { name: string; address?: string };

type FieldChange<T> = { from: T; to: T };
export type LocationChange = {
  id: number;
  name?: FieldChange<string>;
  address?: FieldChange<string | null>;
  slug?: FieldChange<string | null>;
};

// Empareja por orden: el primer local del config con el local de id más bajo, etc.
// (así se crearon con db/provision.ts y db/seed.ts). Si no hay los mismos, no se toca nada.
export function planLocationSync(rows: LocationRow[], config: ConfigLocation[]): LocationChange[] {
  if (config.length === 0) throw new Error("El config del salón no tiene initialLocations");
  if (rows.length !== config.length) {
    throw new Error(
      `En la base hay ${rows.length} local(es) y en el config ${config.length}: no se pueden emparejar solos. ` +
        "Usa `npx tsx db/location-sync.ts <id> <slug>` para cada uno.",
    );
  }
  const sorted = [...rows].sort((a, b) => a.id - b.id);
  const slugs = assignSlugs(config.map((c) => c.name));

  return sorted.flatMap((row, i) => {
    const wanted = config[i];
    const change: LocationChange = { id: row.id };
    if (row.name !== wanted.name) change.name = { from: row.name, to: wanted.name };
    // Sin dirección en el config se deja la que haya
    if (wanted.address !== undefined && row.address !== wanted.address) {
      change.address = { from: row.address, to: wanted.address };
    }
    if (row.slug !== slugs[i]) change.slug = { from: row.slug, to: slugs[i] };
    return change.name || change.address || change.slug ? [change] : [];
  });
}

export type LocationSyncArgs = { kind: "plan" } | { kind: "apply" } | { kind: "set-slug"; id: number; slug: string };

export const LOCATION_SYNC_USAGE = [
  "Uso:",
  "  npx tsx db/location-sync.ts                 (ver qué cambiaría según el config)",
  "  npx tsx db/location-sync.ts --apply         (aplicar nombre, dirección y slug del config)",
  "  npx tsx db/location-sync.ts <id> <slug>     (poner un slug concreto a un local)",
].join("\n");

export function parseLocationSyncArgs(argv: string[]): LocationSyncArgs {
  if (argv.length === 0) return { kind: "plan" };
  if (argv.length === 1 && argv[0] === "--apply") return { kind: "apply" };
  if (argv.length === 2 && !argv[0].startsWith("--")) {
    const id = Number(argv[0]);
    if (!Number.isInteger(id) || id <= 0) throw new Error(`Id no válido: "${argv[0]}"`);
    const slug = argv[1].trim();
    if (!isValidSlug(slug)) throw new Error(`Slug no válido: "${slug}" (minúsculas, números y guiones, p. ej. the-room-studio)`);
    return { kind: "set-slug", id, slug };
  }
  throw new Error(LOCATION_SYNC_USAGE);
}
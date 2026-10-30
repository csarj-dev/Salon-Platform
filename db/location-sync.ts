// Pone los locales de la base al día con el config del salón (initialLocations):
// nombre, dirección y slug. Primero enseña lo que cambiaría; con --apply lo cambia.
// Ejecutar con npx (npm run rompe las opciones en Windows):
//   npx tsx db/location-sync.ts               ver qué cambiaría
//   npx tsx db/location-sync.ts --apply       aplicarlo
//   npx tsx db/location-sync.ts 2 the-room-studio   (poner un slug concreto)
// Ojo: cambiar el slug cambia la dirección de la página del local (los enlaces viejos dejan de ir).
import "dotenv/config";
import { asc, eq, inArray } from "drizzle-orm";
import { db, pgClient } from "./index";
import { location } from "./schema";
import { loadSalonConfig } from "../lib/salon-config";
import { parseLocationSyncArgs, planLocationSync, type LocationChange } from "../lib/location-sync";

const show = (v: string | null) => (v === null ? "(vacío)" : `"${v}"`);

function describe(c: LocationChange): string[] {
  const lines: string[] = [];
  if (c.name) lines.push(`    nombre:    ${show(c.name.from)} → ${show(c.name.to)}`);
  if (c.address) lines.push(`    dirección: ${show(c.address.from)} → ${show(c.address.to)}`);
  if (c.slug) lines.push(`    slug:      ${show(c.slug.from)} → ${show(c.slug.to)}`);
  return lines;
}

async function main() {
  const args = parseLocationSyncArgs(process.argv.slice(2));
  const rows = await db
    .select({ id: location.id, name: location.name, address: location.address, slug: location.slug })
    .from(location)
    .orderBy(asc(location.id));

  if (args.kind === "set-slug") {
    const target = rows.find((r) => r.id === args.id);
    if (!target) throw new Error(`No existe el local con id ${args.id}`);
    const taken = rows.find((r) => r.slug === args.slug && r.id !== args.id);
    if (taken) throw new Error(`El slug "${args.slug}" ya lo usa "${taken.name}" (id ${taken.id})`);
    await db.update(location).set({ slug: args.slug }).where(eq(location.id, args.id));
    console.log(`${target.name} (id ${target.id}): slug ${show(target.slug)} → "${args.slug}"`);
    return;
  }

  const config = await loadSalonConfig();
  const changes = planLocationSync(rows, config.initialLocations);

  if (changes.length === 0) {
    console.log("Los locales ya coinciden con el config.");
    return;
  }

  const print = (title: string) => {
    console.log(title);
    for (const c of changes) {
      const row = rows.find((r) => r.id === c.id)!;
      console.log(`  ${row.name} (id ${c.id})`);
      for (const line of describe(c)) console.log(line);
    }
  };

  if (args.kind === "plan") {
    print("Cambiaría:");
    console.log("\nPara aplicarlo: npx tsx db/location-sync.ts --apply");
    return;
  }

  await db.transaction(async (tx) => {
    // Los slugs en dos pasos (primero vacíos, luego los nuevos) para que dos locales
    // puedan intercambiárselos sin chocar con el índice único
    const withSlug = changes.filter((c) => c.slug);
    if (withSlug.length > 0) {
      await tx.update(location).set({ slug: null }).where(inArray(location.id, withSlug.map((c) => c.id)));
    }
    for (const c of changes) {
      await tx
        .update(location)
        .set({
          ...(c.name ? { name: c.name.to } : {}),
          ...(c.address ? { address: c.address.to } : {}),
          ...(c.slug ? { slug: c.slug.to } : {}),
        })
        .where(eq(location.id, c.id));
    }
  });
  // Solo se cuenta como hecho si la transacción terminó bien
  print("Cambiado:");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pgClient.end());
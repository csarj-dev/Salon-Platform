import "dotenv/config";
import { db } from "./index";
import { location } from "./schema";
import { loadSalonConfig } from "../lib/salon-config";
import { assignSlugs } from "../lib/slug";

async function main() {
  const config = await loadSalonConfig();

  const existing = await db.select({ id: location.id }).from(location).limit(1);
  if (existing.length > 0) {
    console.log("Ya hay locales creados; no se toca nada.");
    process.exit(0);
  }

  // Sin locales en el config, el salón tiene uno solo con su propio nombre
  const initial =
    config.initialLocations.length > 0
      ? config.initialLocations
      : [{ name: config.name }];

  const slugs = assignSlugs(initial.map((l) => l.name));
  await db.insert(location).values(initial.map((l, i) => ({ ...l, slug: slugs[i] })));
  console.log(`Creados ${initial.length} local(es) para ${config.name}.`);
  process.exit(0);
}

main();
// Ejecutar con (npm run rompe las opciones en Windows):
//   npx tsx db/category-color.ts                          ver las categorías y su color
//   npx tsx db/category-color.ts Cejas "#b0607c"          ponerle color (por nombre interno)
//   npx tsx db/category-color.ts 3 "#5f7fa6"              o por id
//   npx tsx db/category-color.ts Cejas --none             quitarlo (sin franja en la agenda)
import "dotenv/config";
import { asc, eq, sql } from "drizzle-orm";
import { db, pgClient } from "./index";
import { serviceCategory } from "./schema";
import { parseCategoryColorArgs } from "../lib/category-cli";

async function main() {
  const args = parseCategoryColorArgs(process.argv.slice(2));

  if (args.command === "list") {
    const rows = await db
      .select({ id: serviceCategory.id, name: serviceCategory.name, color: serviceCategory.color })
      .from(serviceCategory)
      .orderBy(asc(serviceCategory.sortOrder), asc(serviceCategory.name));
    if (rows.length === 0) console.log("No hay categorías.");
    for (const r of rows) console.log(`  ${r.id}  ${r.name}  ${r.color ?? "(sin color)"}`);
    return;
  }

  // Por id, o por nombre sin distinguir mayúsculas
  const matches = await db
    .select({ id: serviceCategory.id, name: serviceCategory.name })
    .from(serviceCategory)
    .where(
      typeof args.category === "number"
        ? eq(serviceCategory.id, args.category)
        : sql`lower(${serviceCategory.name}) = lower(${args.category})`,
    );
  if (matches.length === 0) throw new Error(`No existe la categoría "${args.category}" (sin nada, el comando las lista)`);
  if (matches.length > 1) throw new Error(`Hay varias categorías "${args.category}": usa su id (sin nada, el comando las lista)`);
  const [category] = matches;

  await db.update(serviceCategory).set({ color: args.color }).where(eq(serviceCategory.id, category.id));
  console.log(
    args.color
      ? `${category.name} (id ${category.id}): franja ${args.color} en la agenda.`
      : `${category.name} (id ${category.id}): sin color (sin franja en la agenda).`,
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pgClient.end());
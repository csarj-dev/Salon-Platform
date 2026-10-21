// Ejecutar con (npm run rompe las opciones y las comillas en Windows):
//   npx tsx db/team-profile.ts 3 --role-es "Estilista de cejas" --role-en "Brow stylist" --bio-es "..." --bio-en "..." --list
import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { db, pgClient } from "./index";
import { staff, staffTranslation } from "./schema";
import { loadSalonConfig } from "../lib/salon-config";
import { parseTeamArgs } from "../lib/team-cli";

async function main() {
  const args = parseTeamArgs(process.argv.slice(2));
  const config = await loadSalonConfig();

  const locales = [...new Set([...Object.keys(args.role), ...Object.keys(args.bio)])];
  const unknown = locales.filter((l) => !config.locales.includes(l));
  if (unknown.length > 0) {
    throw new Error(`Idioma(s) que el salón no tiene: ${unknown.join(", ")} (tiene: ${config.locales.join(", ")})`);
  }

  const [member] = await db
    .select({ id: staff.id, name: staff.name })
    .from(staff)
    .where(eq(staff.id, args.staffId));
  if (!member) throw new Error(`No existe staff con id ${args.staffId}`);

  await db.transaction(async (tx) => {
    for (const locale of locales) {
      // Solo se cambia lo que se pasó; el resto del idioma se conserva
      const set: { role?: string; bio?: string } = {};
      if (args.role[locale] !== undefined) set.role = args.role[locale];
      if (args.bio[locale] !== undefined) set.bio = args.bio[locale];

      await tx
        .insert(staffTranslation)
        .values({ staffId: member.id, locale, ...set })
        .onConflictDoUpdate({
          target: [staffTranslation.staffId, staffTranslation.locale],
          set,
        });
    }

    if (args.listing === "list") {
      await tx
        .update(staff)
        .set({ listedOnTeamAt: sql`coalesce(${staff.listedOnTeamAt}, now())` })
        .where(eq(staff.id, member.id));
    } else if (args.listing === "unlist") {
      await tx.update(staff).set({ listedOnTeamAt: null }).where(eq(staff.id, member.id));
    }
  });

  const state =
    args.listing === "list" ? "publicada" : args.listing === "unlist" ? "retirada de la web" : "sin cambios de publicación";
  console.log(`${member.name} (id ${member.id}): ${state}.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pgClient.end());
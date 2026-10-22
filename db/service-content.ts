// Ejecutar con (npm run rompe las opciones y las comillas en Windows):
//   npx tsx db/service-content.ts 26 --slug auto --text-es "Primer párrafo.\n\nSegundo párrafo." --text-en "First paragraph.\n\nSecond paragraph."
import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { db, pgClient } from "./index";
import { service, serviceTranslation } from "./schema";
import { loadSalonConfig } from "../lib/salon-config";
import { parseServiceArgs } from "../lib/service-cli";
import { slugify } from "../lib/slug";

async function main() {
  const args = parseServiceArgs(process.argv.slice(2));
  const config = await loadSalonConfig();

  const locales = Object.keys(args.text);
  const unknown = locales.filter((l) => !config.locales.includes(l));
  if (unknown.length > 0) {
    throw new Error(`Idioma(s) que el salón no tiene: ${unknown.join(", ")} (tiene: ${config.locales.join(", ")})`);
  }

  const [member] = await db
    .select({ id: service.id, name: service.name })
    .from(service)
    .where(eq(service.id, args.serviceId));
  if (!member) throw new Error(`No existe service con id ${args.serviceId}`);

  const slug = args.slug === "auto" ? slugify(member.name) : args.slug;

  await db.transaction(async (tx) => {
    for (const locale of locales) {
      const updated = await tx
        .update(serviceTranslation)
        .set({ longDescription: args.text[locale] })
        .where(
          and(eq(serviceTranslation.serviceId, member.id), eq(serviceTranslation.locale, locale)),
        )
        .returning({ serviceId: serviceTranslation.serviceId });
      if (updated.length === 0) {
        throw new Error(
          `El servicio ${member.id} no tiene traducción en "${locale}" (crea primero su nombre en ese idioma)`,
        );
      }
    }
    if (slug) await tx.update(service).set({ slug }).where(eq(service.id, member.id));
  });

  const parts = [
    locales.length > 0 ? `texto largo en ${locales.join(", ")}` : null,
    slug ? `slug "${slug}"` : null,
  ].filter(Boolean);
  console.log(`${member.name} (id ${member.id}): ${parts.join(" y ")}.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pgClient.end());
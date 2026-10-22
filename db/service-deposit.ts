// Ejecutar con (npm run rompe las opciones en Windows):
//   npx tsx db/service-deposit.ts 31 --amount 15      pide 15 € de depósito
//   npx tsx db/service-deposit.ts 31 --amount 15,50   (admite coma)
//   npx tsx db/service-deposit.ts 31 --none           quita el depósito
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, pgClient } from "./index";
import { service } from "./schema";
import { loadSalonConfig } from "../lib/salon-config";
import { parseServiceDepositArgs } from "../lib/deposit-cli";
import { formatPrice } from "../lib/format";

async function main() {
  const args = parseServiceDepositArgs(process.argv.slice(2));
  const config = await loadSalonConfig();

  const [member] = await db
    .select({ id: service.id, name: service.name, requiresConsultation: service.requiresConsultation })
    .from(service)
    .where(eq(service.id, args.serviceId));
  if (!member) throw new Error(`No existe service con id ${args.serviceId}`);

  await db.update(service).set({ depositCents: args.depositCents }).where(eq(service.id, member.id));

  if (args.depositCents === null) {
    console.log(`${member.name} (id ${member.id}): sin depósito.`);
  } else {
    const amount = formatPrice(args.depositCents, config.defaultLocale, config.currency);
    console.log(`${member.name} (id ${member.id}): depósito de ${amount}.`);
    if (member.requiresConsultation) {
      console.log("Aviso: este servicio se reserva por consulta previa, así que el depósito no se pide en la web.");
    }
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pgClient.end());

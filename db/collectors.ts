// Quién cobra los depósitos de cada profesional. La regla, de lo más concreto a lo más general:
// el cobrador de la profesional (si se le pone aquí), el de su cuenta de Koibox, el de por defecto.
// Los cobradores se definen en el config del salón (payments.collectors). Guía: docs/collectors.md.
// Ejecutar con npx (npm run rompe las opciones en Windows):
//   npx tsx db/collectors.ts list
//   npx tsx db/collectors.ts set 28 amanda
//   npx tsx db/collectors.ts clear 28
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, pgClient } from "./index";
import { staff } from "./schema";
import { salonCollectors } from "../lib/collectors";
import { parseCollectorsArgs } from "../lib/collectors-cli";
import { listStaffCollectors } from "../lib/collectors-db";
import { loadSalonConfig } from "../lib/salon-config";

const SOURCE = { staff: "puesto a ella", account: "por su cuenta de Koibox", default: "por defecto" };

async function main() {
  const config = await loadSalonConfig();
  const { defaultId, byId } = salonCollectors(config);
  const args = parseCollectorsArgs(process.argv.slice(2), [...byId.keys()]);

  if (args.kind === "list") {
    console.log("Cobradores del config:");
    for (const c of byId.values()) {
      const how = c.deposit.mode === "whatsapp" ? `enlace por WhatsApp (+${c.deposit.whatsapp})` : "con instrucciones";
      console.log(`  ${c.id}${c.id === defaultId ? " (por defecto)" : ""}  ${c.label}  · ${how}`);
    }
    console.log("\nProfesionales:");
    for (const r of await listStaffCollectors(config)) {
      const off = r.active ? "" : "  [inactiva]";
      console.log(`  ${r.staffId}  ${r.staffName}${off}  → ${r.choice.collector.id} (${SOURCE[r.choice.source]})`);
      if (r.choice.ignored) {
        console.log(`      ojo: tiene guardado "${r.choice.ignored}", que ya no está en el config (npx tsx db/collectors.ts clear ${r.staffId})`);
      }
    }
    return;
  }

  const [member] = await db.select({ id: staff.id, name: staff.name }).from(staff).where(eq(staff.id, args.staffId));
  if (!member) throw new Error(`No existe la profesional con id ${args.staffId}`);

  const collector = args.kind === "set" ? args.collector : null;
  await db.update(staff).set({ collector }).where(eq(staff.id, member.id));
  console.log(
    collector
      ? `${member.name} (id ${member.id}) → cobra ${byId.get(collector)!.label} (${collector}).`
      : `${member.name} (id ${member.id}) ya no tiene cobrador propio: el de su cuenta o el de por defecto.`,
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pgClient.end());
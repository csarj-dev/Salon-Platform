// Pone Koibox al día a mano (lo mismo que hace el cron /api/cron/koibox):
//   npx tsx db/koibox-sync.ts            enseña lo pendiente, sin tocar nada
//   npx tsx db/koibox-sync.ts --apply    vence los depósitos que tocan y lo lleva todo a Koibox
import "dotenv/config";
import { pgClient } from "./index";
import { formatDateTime } from "../lib/format";
import { findPendingKoiboxWork, syncPendingKoibox, writesToKoibox } from "../lib/koibox-sync";
import { loadSalonConfig } from "../lib/salon-config";

const WHAT: Record<string, string> = {
  push: "apuntarla en Koibox (mirando antes si ya está)",
  deposit_paid: "poner la etiqueta de depósito pagado",
  deposit_expired: "anularla: no pagó el depósito a tiempo",
  cancelled_by_staff: "anularla: la canceló el equipo",
  cancelled_by_client: "anularla: la canceló la clienta",
  moved: "cambiarla de hora en Koibox",
  cleanup: "anular la cita de la hora anterior (se cambió de hora)",
};

async function main() {
  const args = process.argv.slice(2);
  if (args.some((a) => a !== "--apply")) throw new Error("Uso: npx tsx db/koibox-sync.ts [--apply]");
  const config = await loadSalonConfig();
  if (!writesToKoibox(config)) {
    console.log('El salón no trabaja con Koibox (booking.availability no es "koibox"). Nada que hacer.');
    return;
  }

  if (!args.includes("--apply")) {
    const pending = await findPendingKoiboxWork();
    if (pending.length === 0) console.log("Koibox está al día.");
    for (const p of pending) {
      const what = WHAT[p.work.kind === "change" ? p.work.change.kind : p.work.kind];
      console.log(`#${p.id}  ${formatDateTime(p.startsAt, config.defaultLocale, config.timezone)}  ${p.clientName}  → ${what}`);
      if (p.lastError) console.log(`      último error: ${p.lastError}`);
    }
    console.log("\nLos depósitos que venzan ahora se añaden al aplicar. Para aplicarlo: npx tsx db/koibox-sync.ts --apply");
    return;
  }

  const s = await syncPendingKoibox(config);
  console.log(`Depósitos vencidos: ${s.expired}. Pendientes: ${s.checked}, arreglados: ${s.fixed}, fallidos: ${s.failed.length}.`);
  for (const f of s.failed) console.log(`  #${f.id}: ${f.message}`);
  if (s.failed.length > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pgClient.end());
// Ejecutar con:
//   npm run reminders             envía los recordatorios que toquen ahora
//   npm run reminders -- --dry    solo muestra cuáles enviaría, sin enviar nada
import "dotenv/config";
import { pgClient } from "./index";
import { findDueReminders, sendDueReminders } from "../lib/email/reminders";

async function main() {
  const now = new Date();
  if (process.argv.includes("--dry")) {
    const due = await findDueReminders(now);
    if (due.length === 0) console.log("No hay recordatorios pendientes ahora.");
    for (const r of due) console.log(`cita #${r.id}  ${r.startsAt.toISOString()}  → ${r.email}`);
    return;
  }
  const summary = await sendDueReminders(now);
  console.log(
    `Recordatorios: ${summary.checked} pendientes, ${summary.sent} enviados, ${summary.failed} fallidos, ${summary.skipped} omitidos.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pgClient.end());
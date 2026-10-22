// Ejecutar con:
//   npx tsx db/deposits.ts list              citas esperando depósito
//   npx tsx db/deposits.ts list --expired    citas cuyo plazo venció (para escribir a la clienta)
//   npx tsx db/deposits.ts paid 12           el depósito de la cita 12 está recibido
//   npx tsx db/deposits.ts expire            libera los huecos de las que ya vencieron
import "dotenv/config";
import { pgClient } from "./index";
import { expireOverdueDeposits, listDeposits, markDepositPaid, type DepositRow } from "../lib/deposit-db";
import { parseDepositsArgs } from "../lib/deposit-cli";
import { formatDateTime, formatPrice } from "../lib/format";
import { loadSalonConfig } from "../lib/salon-config";

function printRows(rows: DepositRow[], locale: string, zone: string, currency: string) {
  if (rows.length === 0) {
    console.log("No hay citas en este estado.");
    return;
  }
  for (const r of rows) {
    console.log(
      [
        `#${r.id}`,
        formatDateTime(r.startsAt, locale, zone),
        `${r.serviceName} (${r.locationName}, ${r.staffName})`,
        `depósito ${formatPrice(r.depositCents, locale, currency)}`,
        `plazo ${formatDateTime(r.depositDueAt, locale, zone)}`,
        `${r.clientName} ${r.clientPhone}`,
      ].join("  |  "),
    );
  }
}

async function main() {
  const cmd = parseDepositsArgs(process.argv.slice(2));
  const config = await loadSalonConfig();

  if (cmd.command === "list") {
    // Antes de listar, se liberan las que ya vencieron para que no salgan como pendientes
    if (!cmd.expired) await expireOverdueDeposits();
    const rows = await listDeposits(cmd.expired ? "expired" : "pending_deposit");
    printRows(rows, config.defaultLocale, config.timezone, config.currency);
  } else if (cmd.command === "paid") {
    const r = await markDepositPaid(cmd.appointmentId);
    if (r.ok) {
      console.log(`Cita #${cmd.appointmentId}: depósito recibido, cita confirmada.`);
    } else if (r.reason === "not_found") {
      throw new Error(`No existe la cita #${cmd.appointmentId}`);
    } else if (r.reason === "expired") {
      throw new Error(
        `La cita #${cmd.appointmentId} ya caducó y su hueco pudo ocuparse. Habla con la clienta y busca otro horario.`,
      );
    } else {
      throw new Error(`La cita #${cmd.appointmentId} no está esperando depósito.`);
    }
  } else {
    const n = await expireOverdueDeposits();
    console.log(`${n} cita(s) caducada(s), hueco liberado.`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pgClient.end());

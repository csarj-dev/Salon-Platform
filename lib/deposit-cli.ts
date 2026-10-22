// "20" -> 2000, "15,50" -> 1550, "7.5" -> 750. Importes en euros con hasta dos decimales.
export function parseEuros(text: string): number {
  const t = text.trim();
  if (!/^\d+([.,]\d{1,2})?$/.test(t)) {
    throw new Error(`Importe no válido: "${text}" (ejemplos: 20, 15,50)`);
  }
  const cents = Math.round(Number(t.replace(",", ".")) * 100);
  if (cents <= 0) throw new Error("El importe tiene que ser mayor que cero");
  return cents;
}

// ---- db/service-deposit.ts: poner o quitar el depósito de un servicio ----

export const SERVICE_DEPOSIT_USAGE =
  "Uso: npx tsx db/service-deposit.ts <serviceId> --amount <euros> | --none";

export type ServiceDepositArgs = {
  serviceId: number;
  depositCents: number | null; // null = quitar el depósito
};

export function parseServiceDepositArgs(argv: string[]): ServiceDepositArgs {
  const positional: string[] = [];
  let depositCents: number | null | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--amount") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error("Falta el valor de --amount");
      if (depositCents !== undefined) throw new Error("--amount y --none no se pueden usar a la vez");
      depositCents = parseEuros(value);
      i++;
    } else if (arg === "--none") {
      if (depositCents !== undefined) throw new Error("--amount y --none no se pueden usar a la vez");
      depositCents = null;
    } else if (arg.startsWith("--")) {
      throw new Error(`Opción desconocida: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length !== 1) throw new Error(SERVICE_DEPOSIT_USAGE);
  const serviceId = Number(positional[0]);
  if (!Number.isInteger(serviceId) || serviceId <= 0) {
    throw new Error(`Id no válido: "${positional[0]}"`);
  }
  if (depositCents === undefined) throw new Error(`No hay nada que cambiar. ${SERVICE_DEPOSIT_USAGE}`);
  return { serviceId, depositCents };
}

// ---- db/deposits.ts: ver y gestionar los depósitos pendientes ----

export const DEPOSITS_USAGE = [
  "Uso:",
  "  npx tsx db/deposits.ts list [--expired]   citas esperando depósito (o las caducadas)",
  "  npx tsx db/deposits.ts paid <citaId>      confirmar que se recibió el depósito",
  "  npx tsx db/deposits.ts expire             liberar los huecos de las que ya vencieron",
].join("\n");

export type DepositsCommand =
  | { command: "list"; expired: boolean }
  | { command: "paid"; appointmentId: number }
  | { command: "expire" };

export function parseDepositsArgs(argv: string[]): DepositsCommand {
  const [command, ...rest] = argv;

  if (command === "list") {
    const unknown = rest.filter((a) => a !== "--expired");
    if (unknown.length > 0) throw new Error(`Opción desconocida: ${unknown[0]}\n${DEPOSITS_USAGE}`);
    return { command: "list", expired: rest.includes("--expired") };
  }
  if (command === "paid") {
    if (rest.length !== 1) throw new Error(DEPOSITS_USAGE);
    const appointmentId = Number(rest[0]);
    if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
      throw new Error(`Id no válido: "${rest[0]}"`);
    }
    return { command: "paid", appointmentId };
  }
  if (command === "expire") {
    if (rest.length > 0) throw new Error(DEPOSITS_USAGE);
    return { command: "expire" };
  }
  throw new Error(DEPOSITS_USAGE);
}

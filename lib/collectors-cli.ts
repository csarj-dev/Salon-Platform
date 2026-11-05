// Opciones de db/collectors.ts (ver y asignar el cobrador de cada profesional)
import { COLLECTOR_ID } from "./salon-config";

export type CollectorsArgs =
  | { kind: "list" }
  | { kind: "set"; staffId: number; collector: string }
  | { kind: "clear"; staffId: number };

export const COLLECTORS_USAGE = [
  "Uso:",
  "  npx tsx db/collectors.ts list                         quién cobra las citas de cada profesional",
  "  npx tsx db/collectors.ts set <staffId> <cobrador>     esa profesional cobra con ese cobrador",
  "  npx tsx db/collectors.ts clear <staffId>              vuelve al de su cuenta o al de por defecto",
].join("\n");

function staffIdOf(value: string | undefined): number {
  const n = Number(value);
  if (value === undefined || !Number.isInteger(n) || n <= 0) throw new Error(`Id de profesional no válido: "${value ?? ""}"`);
  return n;
}

export function parseCollectorsArgs(argv: string[], collectorIds: string[]): CollectorsArgs {
  const [command, ...rest] = argv;
  if (command === "list" && rest.length === 0) return { kind: "list" };
  if (command === "clear" && rest.length === 1) return { kind: "clear", staffId: staffIdOf(rest[0]) };
  if (command === "set" && rest.length === 2) {
    const staffId = staffIdOf(rest[0]);
    const collector = rest[1];
    if (!COLLECTOR_ID.test(collector) || !collectorIds.includes(collector)) {
      throw new Error(`El cobrador "${collector}" no está en el config (hay: ${collectorIds.join(", ")})`);
    }
    return { kind: "set", staffId, collector };
  }
  throw new Error(COLLECTORS_USAGE);
}
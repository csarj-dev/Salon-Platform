// Opciones de db/koibox-link.ts (enlazar profesionales y servicios con sus ids de Koibox)

export type KoiboxLinkArgs =
  | { kind: "list" }
  | { kind: "staff"; staffId: number; account: string; userId: number }
  | { kind: "staff-clear"; staffId: number }
  | { kind: "service"; serviceId: number; account: string; koiboxServiceId: number }
  | { kind: "service-clear"; serviceId: number; account: string };

export const KOIBOX_LINK_USAGE = [
  "Uso:",
  "  npx tsx db/koibox-link.ts list",
  "  npx tsx db/koibox-link.ts staff <staffId> --account <cuenta> --user <idEnKoibox>",
  "  npx tsx db/koibox-link.ts staff <staffId> --clear",
  "  npx tsx db/koibox-link.ts service <serviceId> --account <cuenta> --koibox <idEnKoibox>",
  "  npx tsx db/koibox-link.ts service <serviceId> --account <cuenta> --clear",
].join("\n");

function positiveInt(value: string | undefined, what: string): number {
  const n = Number(value);
  if (value === undefined || !Number.isInteger(n) || n <= 0) throw new Error(`${what} no válido: "${value ?? ""}"`);
  return n;
}

export function parseKoiboxLinkArgs(argv: string[], accountIds: string[]): KoiboxLinkArgs {
  const [command, ...rest] = argv;
  if (command === "list") {
    if (rest.length > 0) throw new Error(`"list" no lleva más opciones.\n${KOIBOX_LINK_USAGE}`);
    return { kind: "list" };
  }
  if (command !== "staff" && command !== "service") throw new Error(KOIBOX_LINK_USAGE);

  const positional: string[] = [];
  const options: Record<string, string> = {};
  let clear = false;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--clear") {
      clear = true;
    } else if (arg === "--account" || arg === "--user" || arg === "--koibox") {
      const value = rest[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`Falta el valor de ${arg}`);
      options[arg.slice(2)] = value.trim();
      i++;
    } else if (arg.startsWith("--")) {
      throw new Error(`Opción desconocida: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 1) throw new Error(KOIBOX_LINK_USAGE);
  const id = positiveInt(positional[0], "Id");

  const account = options.account;
  if (account !== undefined && !accountIds.includes(account)) {
    throw new Error(
      accountIds.length
        ? `Cuenta "${account}" desconocida (hay: ${accountIds.join(", ")})`
        : "El salón no tiene cuentas de Koibox en el config (koibox.accounts)",
    );
  }

  if (command === "staff") {
    if (options.koibox !== undefined) throw new Error('En "staff" el id de Koibox va con --user');
    if (clear) {
      if (account !== undefined || options.user !== undefined) throw new Error("--clear no se combina con --account ni --user");
      return { kind: "staff-clear", staffId: id };
    }
    if (account === undefined || options.user === undefined) throw new Error(`Faltan --account y --user.\n${KOIBOX_LINK_USAGE}`);
    return { kind: "staff", staffId: id, account, userId: positiveInt(options.user, "Id de usuaria de Koibox") };
  }

  if (options.user !== undefined) throw new Error('En "service" el id de Koibox va con --koibox');
  if (account === undefined) throw new Error(`Falta --account.\n${KOIBOX_LINK_USAGE}`);
  if (clear) {
    if (options.koibox !== undefined) throw new Error("--clear no se combina con --koibox");
    return { kind: "service-clear", serviceId: id, account };
  }
  if (options.koibox === undefined) throw new Error(`Falta --koibox.\n${KOIBOX_LINK_USAGE}`);
  return { kind: "service", serviceId: id, account, koiboxServiceId: positiveInt(options.koibox, "Id de servicio de Koibox") };
}
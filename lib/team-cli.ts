export type TeamProfileArgs = {
  staffId: number;
  role: Record<string, string>; // idioma -> cargo
  bio: Record<string, string>; // idioma -> presentación
  listing?: "list" | "unlist";
};

export const TEAM_USAGE =
  'Uso: npx tsx db/team-profile.ts <staffId> [--role-es "texto"] [--bio-es "texto"] [--role-en "texto"] [--bio-en "texto"] [--list | --unlist]';

export function parseTeamArgs(argv: string[]): TeamProfileArgs {
  const positional: string[] = [];
  const role: Record<string, string> = {};
  const bio: Record<string, string> = {};
  let listing: TeamProfileArgs["listing"];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const text = /^--(role|bio)-([a-z]{2,3}(?:-[a-z0-9]+)?)$/i.exec(arg);

    if (text) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--") || !value.trim()) {
        throw new Error(`Falta el texto de ${arg}`);
      }
      (text[1] === "role" ? role : bio)[text[2].toLowerCase()] = value.trim();
      i++; // el valor ya está consumido
    } else if (arg === "--list" || arg === "--unlist") {
      const next = arg === "--list" ? "list" : "unlist";
      if (listing && listing !== next) throw new Error("--list y --unlist no se pueden usar a la vez");
      listing = next;
    } else if (arg.startsWith("--")) {
      throw new Error(`Opción desconocida: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length !== 1) throw new Error(TEAM_USAGE);
  const staffId = Number(positional[0]);
  if (!Number.isInteger(staffId) || staffId <= 0) throw new Error(`Id no válido: "${positional[0]}"`);

  if (Object.keys(role).length === 0 && Object.keys(bio).length === 0 && !listing) {
    throw new Error(`No hay nada que cambiar. ${TEAM_USAGE}`);
  }
  return { staffId, role, bio, listing };
}
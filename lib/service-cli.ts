import { isValidSlug } from "./slug";

export type ServiceContentArgs = {
  serviceId: number;
  slug?: string; // "auto" = generarlo a partir del nombre
  text: Record<string, string>; // idioma -> descripción larga
};

export const SERVICE_USAGE =
  'Uso: npx tsx db/service-content.ts <serviceId> [--slug <slug>|auto] [--text-es "texto"] [--text-en "texto"]  (usa \\n\\n entre párrafos)';

export function parseServiceArgs(argv: string[]): ServiceContentArgs {
  const positional: string[] = [];
  const text: Record<string, string> = {};
  let slug: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const lang = /^--text-([a-z]{2,3}(?:-[a-z0-9]+)?)$/i.exec(arg);

    if (lang) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--") || !value.trim()) {
        throw new Error(`Falta el texto de ${arg}`);
      }
      text[lang[1].toLowerCase()] = value.replace(/\\n/g, "\n").trim();
      i++;
    } else if (arg === "--slug") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error("Falta el valor de --slug");
      if (value !== "auto" && !isValidSlug(value)) {
        throw new Error(`Slug no válido: "${value}" (minúsculas, números y guiones)`);
      }
      slug = value;
      i++;
    } else if (arg.startsWith("--")) {
      throw new Error(`Opción desconocida: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length !== 1) throw new Error(SERVICE_USAGE);
  const serviceId = Number(positional[0]);
  if (!Number.isInteger(serviceId) || serviceId <= 0) {
    throw new Error(`Id no válido: "${positional[0]}"`);
  }
  if (Object.keys(text).length === 0 && !slug) {
    throw new Error(`No hay nada que cambiar. ${SERVICE_USAGE}`);
  }
  return { serviceId, slug, text };
}
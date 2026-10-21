export const ATTACH_ENTITIES = ["location", "service", "staff"] as const;
export type AttachEntity = (typeof ATTACH_ENTITIES)[number];

export type AttachArgs = {
  entity: AttachEntity;
  id: number;
  file: string;
  alt: Record<string, string>; // idioma -> texto alternativo
};

export const ATTACH_USAGE =
  'Uso: npm run db:photo -- <location|service|staff> <id> <archivo> --alt-es "texto" --alt-en "texto"';

export function parseAttachArgs(argv: string[]): AttachArgs {
  const positional: string[] = [];
  const alt: Record<string, string> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const flag = /^--alt-([a-z]{2,3}(?:-[a-z0-9]+)?)$/i.exec(arg);

    if (flag) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--") || !value.trim()) {
        throw new Error(`Falta el texto de ${arg}`);
      }
      alt[flag[1].toLowerCase()] = value.trim();
      i++; // el valor ya está consumido
    } else if (arg.startsWith("--")) {
      throw new Error(`Opción desconocida: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length !== 3) throw new Error(ATTACH_USAGE);
  const [entity, rawId, file] = positional;

  if (!ATTACH_ENTITIES.includes(entity as AttachEntity)) {
    throw new Error(`Entidad no válida: "${entity}". Usa ${ATTACH_ENTITIES.join(", ")}.`);
  }
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`Id no válido: "${rawId}"`);

  return { entity: entity as AttachEntity, id, file, alt };
}

// Idiomas del salón que se quedaron sin texto alternativo
export function missingAltLocales(alt: Record<string, string>, locales: string[]): string[] {
  return locales.filter((locale) => !alt[locale]?.trim());
}
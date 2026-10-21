// "The Room Centro" -> "the-room-centro"; "Pestañas & Más" -> "pestanas-mas"
// Mismo criterio que el relleno de la migración 0009.
export function slugify(text: string): string {
  const base = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita los acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "location";
}

// Una lista de nombres -> una lista de slugs sin repetidos ("centro", "centro-2", ...)
export function assignSlugs(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const base = slugify(name);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  });
}

// ¿Tiene la forma de un slug válido? Se usa antes de consultar la base de datos
export function isValidSlug(value: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value);
}
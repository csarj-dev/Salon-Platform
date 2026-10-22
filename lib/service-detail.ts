// Texto largo en el idioma pedido; si ese idioma no lo tiene, el del idioma por defecto.
// Un texto vacío o en blanco cuenta como "no hay".
export function pickLongDescription(
  rows: { locale: string; longDescription: string | null }[],
  locale: string,
  defaultLocale: string,
): string | null {
  for (const l of [locale, defaultLocale]) {
    const text = rows.find((r) => r.locale === l)?.longDescription?.trim();
    if (text) return text;
  }
  return null;
}

// Un servicio tiene página propia si tiene slug Y algo que enseñar:
// descripción larga o al menos una foto en la galería
export function hasServiceDetail(input: {
  slug: string | null;
  longDescription: string | null;
  galleryCount: number;
}): boolean {
  return Boolean(input.slug) && (input.longDescription !== null || input.galleryCount > 0);
}

// Párrafos separados por una o más líneas en blanco
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}
export type Translation = {
  locale: string;
  name: string;
  description: string | null;
};

// Elige la traducción del idioma pedido, si no la del idioma por defecto,
// y si tampoco existe, el nombre interno del servicio
export function pickTranslation(
  translations: Translation[],
  locale: string,
  defaultLocale: string,
  fallbackName: string,
): { name: string; description: string | null } {
  const chosen =
    translations.find((t) => t.locale === locale) ??
    translations.find((t) => t.locale === defaultLocale);

  return {
    name: chosen?.name ?? fallbackName,
    description: chosen?.description ?? null,
  };
}
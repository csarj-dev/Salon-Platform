type LocaleSetup = { locales: readonly string[]; defaultLocale: string };

// Falla si los idiomas del entorno no coinciden con los del config del salón
export function assertLocalesMatch(config: LocaleSetup, env: LocaleSetup): void {
  const sorted = (l: readonly string[]) => [...l].sort().join(",");
  const same =
    config.defaultLocale === env.defaultLocale &&
    sorted(config.locales) === sorted(env.locales);

  if (!same) {
    throw new Error(
      `Los idiomas del config (${config.locales.join(",")}, por defecto ${config.defaultLocale}) ` +
        `no coinciden con NEXT_PUBLIC_LOCALES (${env.locales.join(",")}) y ` +
        `NEXT_PUBLIC_DEFAULT_LOCALE (${env.defaultLocale})`,
    );
  }
}
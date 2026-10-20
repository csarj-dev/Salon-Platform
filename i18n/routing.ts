import { defineRouting } from "next-intl/routing";

// Estas variables son públicas porque este archivo también se ejecuta en el navegador.
// La comprobación contra el config del salón se hace en el layout.
const locales = (process.env.NEXT_PUBLIC_LOCALES ?? "")
  .split(",")
  .map((l) => l.trim())
  .filter(Boolean);
const defaultLocale = process.env.NEXT_PUBLIC_DEFAULT_LOCALE ?? locales[0];

if (locales.length === 0 || !defaultLocale || !locales.includes(defaultLocale)) {
  throw new Error(
    "Configura NEXT_PUBLIC_LOCALES (ej. es,en) y NEXT_PUBLIC_DEFAULT_LOCALE (uno de ellos)",
  );
}

export const routing = defineRouting({ locales, defaultLocale });
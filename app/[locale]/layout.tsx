import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import { Cormorant_Garamond, Geist } from "next/font/google";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { loadSalonConfig } from "@/lib/salon-config";
import { themeToCssVars } from "@/lib/theme";
import { assertLocalesMatch } from "@/lib/locales-guard";
import "../globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
// Solo para los títulos si el salón elige theme.displayFont = "serif". Sin preload: se descarga
// únicamente en las páginas que la usan.
const serifDisplay = Cormorant_Garamond({
  variable: "--font-cormorant", // no "--font-serif": ese nombre ya lo usa Tailwind para su serif genérica
  subsets: ["latin"],
  weight: ["500", "600"],
  preload: false,
});

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Omit<Props, "children">): Promise<Metadata> {
  const { locale } = await params;
  const [config, t] = await Promise.all([
    loadSalonConfig(),
    getTranslations({ locale, namespace: "Metadata" }),
  ]);
  return {
    title: { default: config.name, template: `%s · ${config.name}` },
    description: t("description"),
  };
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

    const [config, messages] = await Promise.all([loadSalonConfig(), getMessages()]);
  assertLocalesMatch(config, routing);

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${serifDisplay.variable}`}
      style={themeToCssVars(config.theme) as CSSProperties}
    >
      <body className="font-sans antialiased">
        <NextIntlClientProvider messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
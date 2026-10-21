import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import { Geist } from "next/font/google";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { loadSalonConfig } from "@/lib/salon-config";
import { themeToCssVars } from "@/lib/theme";
import { assertLocalesMatch } from "@/lib/locales-guard";
import { buildWhatsAppLink } from "@/lib/whatsapp-link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { WhatsAppFloating } from "@/components/whatsapp-button";
import "../globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

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

  const [config, messages, tShow] = await Promise.all([
    loadSalonConfig(),
    getMessages(),
    getTranslations({ locale, namespace: "Showcase" }),
  ]);
  assertLocalesMatch(config, routing);

  // Enlace de contacto genérico (pie y botón flotante)
  const whatsappHref = config.contact.whatsapp
    ? buildWhatsAppLink(config.contact.whatsapp, tShow("messageGeneric"))
    : null;

  return (
    <html lang={locale} style={themeToCssVars(config.theme) as CSSProperties}>
      <body className={`${geistSans.variable} font-sans antialiased`}>
        <NextIntlClientProvider messages={messages}>
          <SiteHeader name={config.name} branding={config.branding} />
          {children}
          <SiteFooter
            name={config.name}
            whatsappHref={whatsappHref}
            email={config.contact.email}
            instagram={config.contact.instagram}
          />
          {/* Siempre visible mientras el canal whatsapp esté activo */}
          {config.booking.channels.includes("whatsapp") && whatsappHref && (
            <WhatsAppFloating href={whatsappHref} label={tShow("whatsappChat")} />
          )}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
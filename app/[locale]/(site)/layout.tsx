import type { ReactNode } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { loadSalonConfig } from "@/lib/salon-config";
import { buildWhatsAppLink } from "@/lib/whatsapp-link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { WhatsAppFloating } from "@/components/whatsapp-button";

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

// Cabecera, pie y botón de WhatsApp: solo para la web pública (no para /admin)
export default async function SiteLayout({ children, params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [config, tShow] = await Promise.all([
    loadSalonConfig(),
    getTranslations({ locale, namespace: "Showcase" }),
  ]);

  // Enlace de contacto genérico (pie y botón flotante)
  const whatsappHref = config.contact.whatsapp
    ? buildWhatsAppLink(config.contact.whatsapp, tShow("messageGeneric"))
    : null;

  return (
    <>
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
    </>
  );
}
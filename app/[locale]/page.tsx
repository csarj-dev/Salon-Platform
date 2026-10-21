import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { Section } from "@/components/showcase/section";
import { Gallery } from "@/components/showcase/gallery";
import { FeaturedServices } from "@/components/showcase/featured-services";
import { LocationsSection } from "@/components/showcase/locations-section";
import { loadSalonConfig } from "@/lib/salon-config";
import { heroCta } from "@/lib/showcase-links";
import { buildWhatsAppLink } from "@/lib/whatsapp-link";
import { cn } from "@/lib/utils";

type Props = { params: Promise<{ locale: string }> };

export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [t, tShow, config] = await Promise.all([
    getTranslations("Home"),
    getTranslations("Showcase"),
    loadSalonConfig(),
  ]);

  const whatsappHref = config.contact.whatsapp
    ? buildWhatsAppLink(config.contact.whatsapp, tShow("messageGeneric"))
    : null;
  const cta = heroCta({ channels: config.booking.channels, whatsappHref });

  return (
    <main className="mx-auto max-w-3xl px-6">
      {/* 1. Portada: una frase y un solo botón principal */}
      <section className="py-16 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">
          {config.branding?.logoText ?? config.name}
        </h1>
        <p className="mx-auto mt-4 max-w-md text-muted-foreground">{t("tagline")}</p>
        <div className="mt-8 flex justify-center">
          {cta.type === "whatsapp" ? (
            <WhatsAppButton href={cta.href}>{tShow(cta.labelKey)}</WhatsAppButton>
          ) : (
            <Link
              href={cta.href}
              className={cn(buttonVariants({ size: "lg" }), "h-11 px-6")}
            >
              {tShow(cta.labelKey)}
            </Link>
          )}
        </div>
      </section>

      {/* 2. Servicios destacados (lee la base de datos, por eso va en Suspense) */}
      <Suspense fallback={<Skeleton className="my-10 h-40 w-full" />}>
        <FeaturedServices locale={locale} defaultLocale={config.defaultLocale} />
      </Suspense>

      {/* 3. El estudio */}
      <Section title={t("aboutTitle")}>
        <p className="max-w-prose text-muted-foreground">{t("aboutText")}</p>
      </Section>

      {/* 4. Galería */}
      {config.gallery.length > 0 && (
        <Section title={t("galleryTitle")}>
          <Gallery items={config.gallery} locale={locale} defaultLocale={config.defaultLocale} />
        </Section>
      )}

      {/* 5. Locales */}
      <Suspense fallback={<Skeleton className="my-10 h-56 w-full" />}>
        <LocationsSection locale={locale} whatsapp={config.contact.whatsapp} />
      </Suspense>
    </main>
  );
}
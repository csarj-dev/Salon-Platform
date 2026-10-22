import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { Photo } from "@/components/photo";
import { BookingActions } from "@/components/showcase/booking-actions";
import { Section } from "@/components/showcase/section";
import { resolveBookingCta } from "@/lib/booking-cta";
import { getServiceBySlug } from "@/lib/catalog";
import { formatPrice } from "@/lib/format";
import { getPhotoViews, type PhotoView } from "@/lib/photos";
import { loadSalonConfig } from "@/lib/salon-config";
import { splitParagraphs } from "@/lib/service-detail";
import { serviceWhatsApp } from "@/lib/showcase-links";
import { isValidSlug } from "@/lib/slug";

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function ServiceDetailContent({ params }: Props) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale) || !isValidSlug(slug)) notFound();

  const [config, t, tShow] = await Promise.all([
    loadSalonConfig(),
    getTranslations({ locale, namespace: "Service" }),
    getTranslations({ locale, namespace: "Showcase" }),
  ]);

  const detail = await getServiceBySlug(slug, locale, config.defaultLocale);
  if (!detail) notFound();

  const photos = await getPhotoViews(
    [detail.photoId, ...detail.galleryPhotoIds],
    locale,
    config.defaultLocale,
  );
  const cover = detail.photoId === null ? undefined : photos.get(detail.photoId);
  const gallery = detail.galleryPhotoIds
    .map((id) => photos.get(id))
    .filter((p): p is PhotoView => p !== undefined);
  const paragraphs = detail.longDescription ? splitParagraphs(detail.longDescription) : [];

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link href="/services" className="text-sm text-muted-foreground">
        ← {t("back")}
      </Link>
      <h1 className="mt-4 mb-3 text-3xl font-semibold tracking-tight">{detail.name}</h1>
      {detail.description && (
        <p className="mb-6 text-lg text-muted-foreground">{detail.description}</p>
      )}

      {cover && (
        <Photo
          photo={cover}
          ratio="16 / 9"
          sizes="(min-width: 768px) 768px, 100vw"
          priority
          className="mb-8 rounded-xl"
        />
      )}

      {paragraphs.length > 0 && (
        <div className="max-w-prose space-y-4">
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      )}

      {gallery.length > 0 && (
        <Section title={t("galleryTitle")}>
          <ul className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {gallery.map((p) => (
              <li key={p.id} className="overflow-hidden rounded-lg">
                <Photo photo={p} sizes="(min-width: 768px) 33vw, 50vw" />
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={t("offersTitle")}>
        <ul className="space-y-3">
          {detail.offers.map((o) => {
            const ctas = resolveBookingCta({
              channels: config.booking.channels,
              service: detail,
              locationId: o.location.id,
              whatsapp: serviceWhatsApp(config.contact.whatsapp, {
                book: tShow("messageBook", { service: detail.name, location: o.location.name }),
                consult: tShow("messageConsult", { service: detail.name, location: o.location.name }),
              }),
            });
            return (
              <li key={o.location.id} className="rounded-lg border p-4">
                <div className="flex items-baseline justify-between gap-4">
                  <h3 className="font-medium">
                    {o.location.slug ? (
                      <Link
                        href={`/locations/${o.location.slug}`}
                        className="underline underline-offset-4"
                      >
                        {o.location.name}
                      </Link>
                    ) : (
                      o.location.name
                    )}
                  </h3>
                  <span className="shrink-0 font-medium tabular-nums">
                    {formatPrice(o.priceCents, locale, config.currency)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {tShow("minutes", { count: o.durationMin })}
                </p>
                {ctas.length > 0 && (
                  <div className="mt-3">
                    <BookingActions ctas={ctas} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Section>
    </div>
  );
}
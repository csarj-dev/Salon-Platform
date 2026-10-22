import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { Photo } from "@/components/photo";
import { LocationCard } from "@/components/showcase/location-card";
import { PriceList } from "@/components/showcase/price-list";
import { Section } from "@/components/showcase/section";
import { resolveBookingCta } from "@/lib/booking-cta";
import {
  getLocationBySlug, listLocationGalleryPhotoIds, listServicesByCategory, listTeam
} from "@/lib/catalog";
import { formatOpeningHours, groupOpeningHours } from "@/lib/opening-hours";
import { getPhotoViews, type PhotoView } from "@/lib/photos";
import { loadSalonConfig } from "@/lib/salon-config";
import { serviceWhatsApp } from "@/lib/showcase-links";
import { isValidSlug } from "@/lib/slug";
import { buildWhatsAppLink } from "@/lib/whatsapp-link";
import { TeamCard } from "@/components/showcase/team-card";
import { initialsOf } from "@/lib/initials";

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function LocationContent({ params }: Props) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale) || !isValidSlug(slug)) notFound();

  const [config, t, tShow] = await Promise.all([
    loadSalonConfig(),
    getTranslations({ locale, namespace: "Location" }),
    getTranslations({ locale, namespace: "Showcase" }),
  ]);

  const location = await getLocationBySlug(slug);
  if (!location) notFound();

    const [galleryIds, groups, team] = await Promise.all([
    listLocationGalleryPhotoIds(location.id),
    listServicesByCategory(location.id, locale, config.defaultLocale),
    listTeam(locale, config.defaultLocale, { locationId: location.id }),
  ]);
  const photos = await getPhotoViews(
    [location.photoId, ...galleryIds, ...team.map((m) => m.photoId)],
    locale,
    config.defaultLocale,
  );
  const cover = location.photoId === null ? undefined : photos.get(location.photoId);
  const gallery = galleryIds
    .map((id) => photos.get(id))
    .filter((p): p is PhotoView => p !== undefined);

  const whatsapp = config.contact.whatsapp;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link href="/#locales" className="text-sm text-muted-foreground">
        ← {t("back")}
      </Link>
      <h1 className="mt-4 mb-6 text-3xl font-semibold tracking-tight">{location.name}</h1>

      {cover && (
        <Photo
          photo={cover}
          ratio="16 / 9"
          sizes="(min-width: 768px) 768px, 100vw"
          priority
          className="mb-8 rounded-xl"
        />
      )}

      <LocationCard
        hideHeading
        name={location.name}
        address={location.address}
        phone={location.phone}
        mapsUrl={location.mapsUrl}
        hours={formatOpeningHours(groupOpeningHours(location.hours), locale)}
        whatsappHref={
          whatsapp
            ? buildWhatsAppLink(whatsapp, tShow("messageLocation", { location: location.name }))
            : null
        }
      />

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

      {team.length > 0 && (
        <Section title={t("teamTitle")}>
          <ul className="grid gap-4 sm:grid-cols-2">
            {team.map((m) => (
              <li key={m.id}>
                <TeamCard
                  name={m.name}
                  role={m.role}
                  bio={m.bio}
                  photo={m.photoId === null ? undefined : photos.get(m.photoId)}
                  initials={initialsOf(m.name)}
                />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {groups.length > 0 && (
        <Section title={t("servicesTitle")}>
          <PriceList
            groups={groups}
            locale={locale}
            defaultLocale={config.defaultLocale}
            currency={config.currency}
            ctaFor={(s) =>
              resolveBookingCta({
                channels: config.booking.channels,
                service: s,
                locationId: location.id,
                whatsapp: serviceWhatsApp(whatsapp, {
                  book: tShow("messageBook", { service: s.name, location: location.name }),
                  consult: tShow("messageConsult", { service: s.name, location: location.name }),
                }),
              })
            }
          />
        </Section>
      )}
    </div>
  );
}
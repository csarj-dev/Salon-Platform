import { getTranslations } from "next-intl/server";
import { LocationCard } from "@/components/showcase/location-card";
import { Section } from "@/components/showcase/section";
import { listLocationsWithHours } from "@/lib/catalog";
import { formatOpeningHours, groupOpeningHours } from "@/lib/opening-hours";
import { buildWhatsAppLink } from "@/lib/whatsapp-link";

type Props = { locale: string; whatsapp?: string };

export async function LocationsSection({ locale, whatsapp }: Props) {
  const [t, tShow, locations] = await Promise.all([
    getTranslations("Home"),
    getTranslations("Showcase"),
    listLocationsWithHours(),
  ]);

  if (locations.length === 0) return null;

  return (
    <Section id="locales" title={t("locationsTitle")}>
      <ul className="grid gap-4 md:grid-cols-2">
        {locations.map((l) => (
          <li key={l.id}>
            <LocationCard
              name={l.name}
              address={l.address}
              phone={l.phone}
              mapsUrl={l.mapsUrl}
              hours={formatOpeningHours(groupOpeningHours(l.hours), locale)}
              whatsappHref={
                whatsapp
                  ? buildWhatsAppLink(whatsapp, tShow("messageLocation", { location: l.name }))
                  : null
              }
            />
          </li>
        ))}
      </ul>
    </Section>
  );
}
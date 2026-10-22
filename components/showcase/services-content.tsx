import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { PriceList } from "@/components/showcase/price-list";
import { resolveBookingCta } from "@/lib/booking-cta";
import { parseFlowParams } from "@/lib/booking-flow";
import { listActiveLocations, listServicesByCategory } from "@/lib/catalog";
import { loadSalonConfig } from "@/lib/salon-config";
import { serviceWhatsApp } from "@/lib/showcase-links";
import { cn } from "@/lib/utils";

type Props = {
  locale: string;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function ServicesContent({ locale, searchParams }: Props) {
  const [raw, config, t, tShow] = await Promise.all([
    searchParams,
    loadSalonConfig(),
    getTranslations("Services"),
    getTranslations("Showcase"),
  ]);

  const locations = await listActiveLocations();
  if (locations.length === 0) {
    return <p className="text-muted-foreground">{t("empty")}</p>;
  }

  // ?location=ID; si no es válido o no existe, el primero
  const wanted = parseFlowParams(raw).location;
  const location = locations.find((l) => l.id === wanted) ?? locations[0];

  const groups = await listServicesByCategory(location.id, locale, config.defaultLocale);

  return (
    <div className="space-y-6">
      {locations.length > 1 && (
        <nav aria-label={t("locationPicker")}>
          <ul className="flex flex-wrap gap-2">
            {locations.map((l) => {
              const active = l.id === location.id;
              return (
                <li key={l.id}>
                  <Link
                    href={{ pathname: "/services", query: { location: String(l.id) } }}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "inline-flex h-11 items-center rounded-full border px-5 text-sm font-medium",
                      active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                    )}
                  >
                    {l.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}

      {location.address && <p className="text-sm text-muted-foreground">{location.address}</p>}

      {groups.length === 0 ? (
        <p className="text-muted-foreground">{t("noServices")}</p>
      ) : (
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
              whatsapp: serviceWhatsApp(config.contact.whatsapp, {
                book: tShow("messageBook", { service: s.name, location: location.name }),
                consult: tShow("messageConsult", { service: s.name, location: location.name }),
              }),
            })
          }
        />
      )}
    </div>
  );
}
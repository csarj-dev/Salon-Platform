import { ChevronDown } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { BookingActions } from "@/components/showcase/booking-actions";
import { ServiceRow } from "@/components/showcase/service-row";
import type { CatalogService, ServiceGroup } from "@/lib/catalog";
import type { BookingCta } from "@/lib/booking-cta";
import { formatPrice } from "@/lib/format";
import { getPhotoViews } from "@/lib/photos";

type Props = {
  groups: ServiceGroup[];
  locale: string;
  defaultLocale: string;
  currency: string;
  // Qué botones lleva cada servicio (ver lib/booking-cta.ts); lista vacía = sin botones
  ctaFor: (service: CatalogService) => BookingCta[];
};

export async function PriceList({ groups, locale, defaultLocale, currency, ctaFor }: Props) {
  const t = await getTranslations("Showcase");

  const photos = await getPhotoViews(
    groups.flatMap((g) => g.services.map((s) => s.photoId)),
    locale,
    defaultLocale,
  );

  const renderRows = (services: CatalogService[]) => (
    <ul className="divide-y">
      {services.map((s) => {
        const ctas = ctaFor(s);
        return (
          <ServiceRow
            key={s.id}
            name={s.name}
            description={s.description}
            duration={t("minutes", { count: s.durationMin })}
            price={formatPrice(s.priceCents, locale, currency)}
            badge={
              s.requiresConsultation
                ? t("consultationBadge")
                : s.depositCents
                  ? t("depositBadge", { amount: formatPrice(s.depositCents, locale, currency) })
                  : undefined
            }
            action={ctas.length > 0 ? <BookingActions ctas={ctas} /> : undefined}
            photo={s.photoId === null ? undefined : photos.get(s.photoId)}
            detailHref={s.hasDetail && s.slug ? `/services/${s.slug}` : undefined}
            detailLabel={t("viewDetails")}
          />
        );
      })}
    </ul>
  );

  return (
    <div className="space-y-2">
      {groups.map((g) => (
        <details key={g.categoryId ?? "other"} open className="group border-b">
          <summary className="flex cursor-pointer list-none items-center justify-between py-4 text-lg font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
            {g.name ?? t("otherServices")}
            <ChevronDown
              className="size-5 text-muted-foreground transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>
          {renderRows(g.services)}
        </details>
      ))}
    </div>
  );
}
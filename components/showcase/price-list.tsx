import { ChevronDown } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { ServiceRow } from "@/components/showcase/service-row";
import type { CatalogService, ServiceGroup } from "@/lib/catalog";
import type { BookingCta } from "@/lib/booking-cta";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

type Props = {
  groups: ServiceGroup[];
  locale: string;
  currency: string;
  // Qué botones lleva cada servicio (ver lib/booking-cta.ts); lista vacía = sin botones
  ctaFor: (service: CatalogService) => BookingCta[];
};

export async function PriceList({ groups, locale, currency, ctaFor }: Props) {
  const t = await getTranslations("Showcase");

  // La primera acción es la principal (con borde); las demás, secundarias (sin borde)
  const renderActions = (ctas: BookingCta[]) => {
    if (ctas.length === 0) return undefined;
    return (
      <div className="flex flex-wrap items-center gap-2">
        {ctas.map((cta, i) => {
          const variant = i === 0 ? "outline" : "ghost";
          return cta.type === "whatsapp" ? (
            <WhatsAppButton key={cta.labelKey} href={cta.href} variant={variant}>
              {t(cta.labelKey)}
            </WhatsAppButton>
          ) : (
            <Link
              key={cta.labelKey}
              href={cta.href}
              className={cn(buttonVariants({ variant, size: "lg" }), "h-11 px-5")}
            >
              {t(cta.labelKey)}
            </Link>
          );
        })}
      </div>
    );
  };

  const renderRows = (services: CatalogService[]) => (
    <ul className="divide-y">
      {services.map((s) => (
        <ServiceRow
          key={s.id}
          name={s.name}
          description={s.description}
          duration={t("minutes", { count: s.durationMin })}
          price={formatPrice(s.priceCents, locale, currency)}
          badge={s.requiresConsultation ? t("consultationBadge") : undefined}
          action={renderActions(ctaFor(s))}
        />
      ))}
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
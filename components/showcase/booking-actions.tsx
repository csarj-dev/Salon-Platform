import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { WhatsAppButton } from "@/components/whatsapp-button";
import type { BookingCta } from "@/lib/booking-cta";
import { cn } from "@/lib/utils";

// La primera acción es la principal (con borde); las demás, secundarias (sin borde).
// Sin acciones no pinta nada.
export async function BookingActions({ ctas }: { ctas: BookingCta[] }) {
  if (ctas.length === 0) return null;
  const t = await getTranslations("Showcase");

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
}
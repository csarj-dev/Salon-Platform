import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Section } from "@/components/showcase/section";
import { listFeaturedServices } from "@/lib/catalog";

type Props = { locale: string; defaultLocale: string };

export async function FeaturedServices({ locale, defaultLocale }: Props) {
  const [t, tShow, services] = await Promise.all([
    getTranslations("Home"),
    getTranslations("Showcase"),
    listFeaturedServices(locale, defaultLocale),
  ]);

  if (services.length === 0) return null;

  return (
    <Section title={t("featuredTitle")}>
      <ul className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
        {services.map((s) => (
          <li key={s.id}>
            <Card className="h-full">
              <CardContent>
                <h3 className="font-medium">{s.name}</h3>
                {s.description && (
                  <p className="mt-1 text-sm text-muted-foreground">{s.description}</p>
                )}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
      <Link
        href="/services"
        className="mt-6 inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4"
      >
        {tShow("viewMenu")}
      </Link>
    </Section>
  );
}
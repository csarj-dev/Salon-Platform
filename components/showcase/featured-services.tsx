import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Photo } from "@/components/photo";
import { Section } from "@/components/showcase/section";
import { listFeaturedServices } from "@/lib/catalog";
import { getPhotoViews } from "@/lib/photos";

type Props = { locale: string; defaultLocale: string };

export async function FeaturedServices({ locale, defaultLocale }: Props) {
  const [t, tShow, services] = await Promise.all([
    getTranslations("Home"),
    getTranslations("Showcase"),
    listFeaturedServices(locale, defaultLocale),
  ]);

  if (services.length === 0) return null;

  const photos = await getPhotoViews(
    services.map((s) => s.photoId),
    locale,
    defaultLocale,
  );

  return (
    <Section title={t("featuredTitle")}>
      <ul className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
        {services.map((s) => {
          const photo = s.photoId === null ? undefined : photos.get(s.photoId);
          return (
            <li key={s.id}>
              <Card className="h-full">
                <CardContent className="space-y-3">
                  {photo && (
                    <Photo
                      photo={photo}
                      ratio="4 / 3"
                      sizes="(min-width: 768px) 33vw, (min-width: 640px) 50vw, 100vw"
                      className="rounded-lg"
                    />
                  )}
                  <div>
                    <h3 className="font-medium">{s.name}</h3>
                    {s.description && (
                      <p className="mt-1 text-sm text-muted-foreground">{s.description}</p>
                    )}
                  </div>
                  {s.hasDetail && s.slug && (
                    <Link
                      href={`/services/${s.slug}`}
                      className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4"
                    >
                      {tShow("viewDetails")}
                    </Link>
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
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
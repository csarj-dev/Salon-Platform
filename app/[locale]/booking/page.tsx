import { Suspense } from "react";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { BookingSteps } from "@/components/booking/booking-steps";
import { StepSkeleton } from "@/components/booking/step-skeleton";
import { loadSalonConfig } from "@/lib/salon-config";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function BookPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const [t, config] = await Promise.all([getTranslations("Booking"), loadSalonConfig()]);

  // Sin el canal online, la reserva no existe: tampoco por URL directa
  if (!config.booking.channels.includes("online")) notFound();

  return (
    <main className="mx-auto max-w-xl px-6 py-6">
      <div className="mb-6">
        <Link href="/" className="text-sm text-muted-foreground">
          ← {t("back")}
        </Link>
      </div>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">{t("title")}</h1>

      {/* La URL y la base de datos se leen dentro de Suspense */}
      <Suspense fallback={<StepSkeleton />}>
        <BookingSteps locale={locale} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
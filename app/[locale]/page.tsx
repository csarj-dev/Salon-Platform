import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { loadSalonConfig } from "@/lib/salon-config";
import { BrandLogo } from "@/components/brand-logo";

type Props = { params: Promise<{ locale: string }> };

export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [t, config] = await Promise.all([getTranslations("Home"), loadSalonConfig()]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-6 py-6">
      <div className="flex justify-end">
        <LocaleSwitcher />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">
          <BrandLogo branding={config.branding} name={config.name} />
        </h1>
        <p className="text-muted-foreground">{t("tagline")}</p>
        <Link href="/booking" className={buttonVariants({ size: "lg" })}>
          {t("book")}
        </Link>
      </div>
    </main>
  );
}
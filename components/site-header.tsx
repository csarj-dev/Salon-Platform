import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { SiteNav } from "@/components/site-nav";
import type { SalonConfig } from "@/lib/salon-config";

type Props = { name: string; branding: SalonConfig["branding"] };

export async function SiteHeader({ name, branding }: Props) {
  const t = await getTranslations("Nav");

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-6">
        <Link href="/" aria-label={name} className="flex items-center">
          <BrandLogo branding={branding} name={name} className="h-8 w-auto" />
        </Link>
        <SiteNav
          links={[
            { href: "/services", label: t("services") },
            { href: "/#locales", label: t("locations") },
          ]}
          navLabel={t("label")}
          openLabel={t("openMenu")}
          closeLabel={t("closeMenu")}
        />
      </div>
    </header>
  );
}
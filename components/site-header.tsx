import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { SiteNav } from "@/components/site-nav";
import { hasListedTeam } from "@/lib/catalog";
import type { SalonConfig } from "@/lib/salon-config";

type Props = { name: string; branding: SalonConfig["branding"] };

type NavProps = {
  links: { href: string; label: string }[];
  teamLabel: string;
  navLabel: string;
  openLabel: string;
  closeLabel: string;
};

// Lee la base de datos para saber si hay equipo publicado: por eso va dentro de <Suspense>
async function HeaderNav({ links, teamLabel, ...labels }: NavProps) {
  const withTeam = await hasListedTeam();
  const [services, ...rest] = links;
  return (
    <SiteNav
      links={withTeam ? [services, { href: "/team", label: teamLabel }, ...rest] : links}
      {...labels}
    />
  );
}

export async function SiteHeader({ name, branding }: Props) {
  const t = await getTranslations("Nav");
  const links = [
    { href: "/services", label: t("services") },
    { href: "/#locales", label: t("locations") },
  ];
  const labels = {
    navLabel: t("label"),
    openLabel: t("openMenu"),
    closeLabel: t("closeMenu"),
  };

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-6">
        <Link href="/" aria-label={name} className="flex items-center">
          <BrandLogo branding={branding} name={name} className="h-7 w-auto" />
        </Link>
        <Suspense fallback={<SiteNav links={links} {...labels} />}>
          <HeaderNav links={links} teamLabel={t("team")} {...labels} />
        </Suspense>
      </div>
    </header>
  );
}
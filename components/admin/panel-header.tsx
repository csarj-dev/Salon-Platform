import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { PanelNav, type PanelNavItem } from "@/components/admin/panel-nav";
import { SignOutButton } from "@/components/admin/sign-out-button";
import { Skeleton } from "@/components/ui/skeleton";
import { countPendingDeposits } from "@/lib/deposit-db";
import { writesToKoibox } from "@/lib/koibox-sync";
import { can, parseRoles } from "@/lib/permissions";
import { loadSalonConfig } from "@/lib/salon-config";
import { requireStaff } from "@/lib/session";
import { PanelRefresh } from "./panel-refresh";

type Props = { locale: string; salonName: string };

/**
 * Cabecera del panel: «SALÓN · Panel», las secciones en cápsula y el usuario a la derecha.
 * Lo que no depende de quién eres se pinta al momento; el usuario y las secciones según
 * permisos llegan en <Suspense>.
 */
export async function PanelHeader({ locale, salonName }: Props) {
  const t = await getTranslations({ locale, namespace: "Admin.panel" });
  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex max-w-[75rem] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 md:px-8">
        <Link
          href="/admin"
          className="flex shrink-0 items-baseline gap-3 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="text-base font-semibold tracking-[0.12em] uppercase md:text-lg">{salonName}</span>
          <span className="text-base font-medium text-muted-foreground md:text-lg">{t("brand")}</span>
        </Link>
        <nav aria-label={t("label")} className="order-last w-full lg:order-none lg:w-auto">
          <Suspense fallback={<Skeleton className="h-12 w-full max-w-md" />}>
            <PanelNavLinks locale={locale} />
          </Suspense>
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <Suspense fallback={<Skeleton className="hidden h-4 w-32 sm:block" />}>
            <PanelIdentity locale={locale} />
          </Suspense>
          <PanelRefresh />
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}

/** "Admin · Administrador" */
async function PanelIdentity({ locale }: { locale: string }) {
  const { user, role } = await requireStaff(locale);
  const tRoles = await getTranslations({ locale, namespace: "Admin.roles" });
  const firstRole = parseRoles(role)[0];
  return (
    <p className="hidden truncate text-sm text-muted-foreground sm:block">
      {user.name}
      {firstRole ? ` · ${tRoles(firstRole)}` : ""}
    </p>
  );
}

/** Secciones según los permisos, con el contador de depósitos pendientes. */
async function PanelNavLinks({ locale }: { locale: string }) {
  const { role } = await requireStaff(locale);
  const showDeposits = can(role, "deposits.manage");
  const settings = can(role, "settings.manage");
  const [tNav, pendingDeposits, config] = await Promise.all([
    getTranslations({ locale, namespace: "Admin.nav" }),
    // Se calcula al cargar el panel; se refresca al validar, cancelar o con "Actualizar"
    showDeposits ? countPendingDeposits() : Promise.resolve(0),
    loadSalonConfig(),
  ]);

  const items: PanelNavItem[] = [];
  if (can(role, "appointments.view")) items.push({ href: "/admin/appointments", label: tNav("appointments") });
  if (showDeposits) {
    items.push({
      href: "/admin/deposits",
      label: tNav("deposits"),
      count: pendingDeposits,
      countLabel: tNav("pendingCount", { count: pendingDeposits }),
    });
  }
  if (settings) items.push({ href: "/admin/collectors", label: tNav("collectors") });
  if (settings && writesToKoibox(config)) items.push({ href: "/admin/koibox", label: tNav("koibox") });
  if (can(role, "users.manage")) items.push({ href: "/admin/users", label: tNav("users") });

  return <PanelNav items={items} />;
}
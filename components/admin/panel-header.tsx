import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { SignOutButton } from "@/components/admin/sign-out-button";
import { Skeleton } from "@/components/ui/skeleton";
import { countPendingDeposits } from "@/lib/deposit-db";
import { can, parseRoles } from "@/lib/permissions";
import { requireStaff } from "@/lib/session";
import { PanelRefresh } from "./panel-refresh";

type Props = { locale: string; salonName: string };

/**
 * Cabecera del panel. Lo que no depende de quién eres se pinta al momento;
 * el nombre, el rol y los enlaces según permisos llegan en <Suspense>.
 */
export async function PanelHeader({ locale, salonName }: Props) {
  const [t, tNav] = await Promise.all([
    getTranslations({ locale, namespace: "Admin.panel" }),
    getTranslations({ locale, namespace: "Admin.nav" }),
  ]);
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {salonName} · {t("label")}
          </p>
          <Suspense fallback={<Skeleton className="mt-1 h-3 w-32" />}>
            <PanelIdentity locale={locale} />
          </Suspense>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <PanelRefresh />
          <SignOutButton />
        </div>
      </div>
      <nav
        aria-label={t("label")}
        className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-5 gap-y-1 px-6 pb-3 text-sm"
      >
        <Link href="/admin" className="hover:underline">
          {tNav("home")}
        </Link>
        <Suspense fallback={<Skeleton className="h-4 w-40" />}>
          <PanelNavLinks locale={locale} />
        </Suspense>
      </nav>
    </header>
  );
}

/** "César · Administrador" */
async function PanelIdentity({ locale }: { locale: string }) {
  const { user, role } = await requireStaff(locale);
  const tRoles = await getTranslations({ locale, namespace: "Admin.roles" });
  const firstRole = parseRoles(role)[0];
  return (
    <p className="truncate text-xs text-muted-foreground">
      {user.name}
      {firstRole ? ` · ${tRoles(firstRole)}` : ""}
    </p>
  );
}

/** Enlaces que dependen de los permisos, con el contador de depósitos pendientes. */
async function PanelNavLinks({ locale }: { locale: string }) {
  const { role } = await requireStaff(locale);
  const showDeposits = can(role, "deposits.manage");
  const [tNav, pendingDeposits] = await Promise.all([
    getTranslations({ locale, namespace: "Admin.nav" }),
    // Se calcula al cargar el panel; se refresca al validar, cancelar o con "Actualizar"
    showDeposits ? countPendingDeposits() : Promise.resolve(0),
  ]);

  return (
    <>
      {can(role, "appointments.view") && (
        <Link href="/admin/appointments" className="hover:underline">
          {tNav("appointments")}
        </Link>
      )}
      {showDeposits && (
        <Link href="/admin/deposits" className="inline-flex items-center gap-1.5 hover:underline">
          {tNav("deposits")}
          {pendingDeposits > 0 && (
            <span
              aria-label={tNav("pendingCount", { count: pendingDeposits })}
              className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground"
            >
              {pendingDeposits}
            </span>
          )}
        </Link>
      )}
      {can(role, "settings.manage") && (
        <Link href="/admin/collectors" className="hover:underline">
          {tNav("collectors")}
        </Link>
      )}
      {can(role, "users.manage") && (
        <Link href="/admin/users" className="hover:underline">
          {tNav("users")}
        </Link>
      )}
    </>
  );
}
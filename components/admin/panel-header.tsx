import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { SignOutButton } from "@/components/admin/sign-out-button";

type Props = {
  salonName: string;
  userName: string;
  roleLabel: string;
  showAppointments: boolean;
  showDeposits: boolean;
  showUsers: boolean;
  pendingDeposits: number;
};

export async function PanelHeader({
  salonName,
  userName,
  roleLabel,
  showAppointments,
  showDeposits,
  showUsers,
  pendingDeposits,
}: Props) {
  const t = await getTranslations("Admin.panel");
  const tNav = await getTranslations("Admin.nav");
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {salonName} · {t("label")}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {userName}
            {roleLabel ? ` · ${roleLabel}` : ""}
          </p>
        </div>
        <SignOutButton />
      </div>
      <nav
        aria-label={t("label")}
        className="mx-auto flex max-w-3xl flex-wrap gap-x-5 gap-y-1 px-6 pb-3 text-sm"
      >
        <Link href="/admin" className="hover:underline">
          {tNav("home")}
        </Link>
        {showAppointments && (
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
        {showUsers && (
          <Link href="/admin/users" className="hover:underline">
            {tNav("users")}
          </Link>
        )}
      </nav>
    </header>
  );
}
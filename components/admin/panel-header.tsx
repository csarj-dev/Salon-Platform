import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { SignOutButton } from "@/components/admin/sign-out-button";

type Props = {
  salonName: string;
  userName: string;
  roleLabel: string;
  showUsers: boolean;
};

export async function PanelHeader({ salonName, userName, roleLabel, showUsers }: Props) {
  const t = await getTranslations("Admin.panel");
  const tNav = await getTranslations("Admin.nav");
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-4 px-6">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {salonName} · {t("label")}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {userName}
            {roleLabel ? ` · ${roleLabel}` : ""}
          </p>
        </div>
        <nav aria-label={t("label")} className="flex items-center gap-3 text-sm">
          <Link href="/admin" className="hover:underline">
            {tNav("home")}
          </Link>
          {showUsers && (
            <Link href="/admin/users" className="hover:underline">
              {tNav("users")}
            </Link>
          )}
          <SignOutButton />
        </nav>
      </div>
    </header>
  );
}
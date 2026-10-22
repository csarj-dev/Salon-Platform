import { getTranslations } from "next-intl/server";
import { SignOutButton } from "@/components/admin/sign-out-button";

type Props = { salonName: string; userName: string; roleLabel: string };

export async function PanelHeader({ salonName, userName, roleLabel }: Props) {
  const t = await getTranslations("Admin.panel");
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
        <SignOutButton />
      </div>
    </header>
  );
}
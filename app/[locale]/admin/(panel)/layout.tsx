import type { ReactNode } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PanelHeader } from "@/components/admin/panel-header";
import { loadSalonConfig } from "@/lib/salon-config";
import { parseRoles } from "@/lib/permissions";
import { requireStaff } from "@/lib/session";

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function PanelLayout({ children, params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { user, role } = await requireStaff(locale);
  const [config, t] = await Promise.all([
    loadSalonConfig(),
    getTranslations({ locale, namespace: "Admin" }),
  ]);
  const firstRole = parseRoles(role)[0];

  return (
    <>
      <PanelHeader
        salonName={config.name}
        userName={user.name}
        roleLabel={firstRole ? t(`roles.${firstRole}`) : ""}
      />
      <main className="mx-auto max-w-3xl px-6 py-8">{children}</main>
    </>
  );
}
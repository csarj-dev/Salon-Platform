import type { ReactNode } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PanelHeader } from "@/components/admin/panel-header";
import { countPendingDeposits } from "@/lib/deposit-db";
import { loadSalonConfig } from "@/lib/salon-config";
import { can, parseRoles } from "@/lib/permissions";
import { requireStaff } from "@/lib/session";

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function PanelLayout({ children, params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { user, role } = await requireStaff(locale);
  const showDeposits = can(role, "deposits.manage");
  const [config, t, pendingDeposits] = await Promise.all([
    loadSalonConfig(),
    getTranslations({ locale, namespace: "Admin" }),
    // Se calcula al cargar el panel; se refresca al validar o cancelar
    showDeposits ? countPendingDeposits() : Promise.resolve(0),
  ]);
  const firstRole = parseRoles(role)[0];

  return (
    <>
      <PanelHeader
        salonName={config.name}
        userName={user.name}
        roleLabel={firstRole ? t(`roles.${firstRole}`) : ""}
        showAppointments={can(role, "appointments.view")}
        showDeposits={showDeposits}
        showUsers={can(role, "users.manage")}
        pendingDeposits={pendingDeposits}
      />
      <main className="mx-auto max-w-3xl px-6 py-8">{children}</main>
    </>
  );
}
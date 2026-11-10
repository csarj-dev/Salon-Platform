import type { ReactNode } from "react";
import { setRequestLocale } from "next-intl/server";
import { PanelHeader } from "@/components/admin/panel-header";
import { loadSalonConfig } from "@/lib/salon-config";

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

/**
 * Marco del panel. No lee la sesión: la cabecera se pinta al momento y cada página
 * comprueba su permiso con requireStaff dentro de su propio <Suspense>.
 */
export default async function PanelLayout({ children, params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const config = await loadSalonConfig();

  return (
    <>
      <PanelHeader locale={locale} salonName={config.name} />
      <main className="mx-auto max-w-3xl px-6 py-8">{children}</main>
    </>
  );
}
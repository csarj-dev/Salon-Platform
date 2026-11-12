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
      <main className="mx-auto w-full max-w-[75rem] px-4 py-6 md:px-8 md:py-8">{children}</main>
    </>
  );
}
import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PanelSkeleton } from "@/components/admin/panel-skeleton";
import { parseRoles } from "@/lib/permissions";
import { requireStaff } from "@/lib/session";
import { PageHeader } from "@/components/admin/panel-ui";

type Props = { params: Promise<{ locale: string }> };

export default async function PanelHomePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<PanelSkeleton rows={1} />}>
      <Welcome locale={locale} />
    </Suspense>
  );
}

async function Welcome({ locale }: { locale: string }) {
  // Se vuelve a comprobar aquí: el layout no es una barrera
  const { user, role } = await requireStaff(locale);
  const [t, tRoles] = await Promise.all([
    getTranslations({ locale, namespace: "Admin.panel" }),
    getTranslations({ locale, namespace: "Admin.roles" }),
  ]);
  const firstRole = parseRoles(role)[0];

  return (
    <section className="space-y-4">
      <PageHeader
        title={t("welcome", { name: user.name })}
        description={firstRole ? t("role", { role: tRoles(firstRole) }) : undefined}
      />
      <p className="text-sm">{t("soon")}</p>
    </section>
  );
}
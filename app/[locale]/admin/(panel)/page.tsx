import { getTranslations, setRequestLocale } from "next-intl/server";
import { parseRoles } from "@/lib/permissions";
import { requireStaff } from "@/lib/session";

type Props = { params: Promise<{ locale: string }> };

export default async function PanelHomePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Se vuelve a comprobar aquí: el layout no basta como única barrera
  const { user, role } = await requireStaff(locale);
  const t = await getTranslations({ locale, namespace: "Admin.panel" });
  const tRoles = await getTranslations({ locale, namespace: "Admin.roles" });
  const firstRole = parseRoles(role)[0];

  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">{t("welcome", { name: user.name })}</h1>
      {firstRole && (
        <p className="text-sm text-muted-foreground">
          {t("role", { role: tRoles(firstRole) })}
        </p>
      )}
      <p className="pt-4 text-sm">{t("soon")}</p>
    </section>
  );
}
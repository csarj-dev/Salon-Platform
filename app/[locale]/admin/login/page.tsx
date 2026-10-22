import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { LoginForm } from "@/components/admin/login-form";
import { hasStaffSession } from "@/lib/session";
import { loadSalonConfig } from "@/lib/salon-config";

type Props = { params: Promise<{ locale: string }> };

export default async function AdminLoginPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (await hasStaffSession()) redirect({ href: "/admin", locale });

  const [t, config] = await Promise.all([
    getTranslations({ locale, namespace: "Admin.login" }),
    loadSalonConfig(),
  ]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6 py-10">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">{config.name}</p>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      </div>
      <LoginForm />
    </main>
  );
}
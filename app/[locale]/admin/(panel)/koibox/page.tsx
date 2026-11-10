import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PanelSkeleton } from "@/components/admin/panel-skeleton";
import { StaffKoiboxRow } from "@/components/admin/staff-koibox-row";
import { KoiboxMatchPanel } from "@/components/admin/koibox-match-panel";
import { ServiceKoiboxRow } from "@/components/admin/service-koibox-row";
import { loadKoiboxOverview, loadServiceLinks } from "@/lib/koibox-links-db";
import { writesToKoibox } from "@/lib/koibox-sync";
import { loadSalonConfig } from "@/lib/salon-config";
import { requireStaff } from "@/lib/session";

type Props = { params: Promise<{ locale: string }> };

export default async function KoiboxPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Admin.koibox" });

  return (
    <section className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      </div>
      <Suspense fallback={<PanelSkeleton />}>
        <KoiboxContent locale={locale} />
      </Suspense>
    </section>
  );
}

async function KoiboxContent({ locale }: { locale: string }) {
  await requireStaff(locale, "settings.manage");
  const [config, t] = await Promise.all([
    loadSalonConfig(),
    getTranslations({ locale, namespace: "Admin.koibox" }),
  ]);
  // Un salón sin Koibox no tiene esta pantalla
  if (!writesToKoibox(config)) notFound();

  const [overview, services] = await Promise.all([loadKoiboxOverview(config), loadServiceLinks(config)]);
  const accounts = overview.accounts.map((a) => ({ id: a.id, label: a.label }));
  const accountLabels = Object.fromEntries(accounts.map((a) => [a.id, a.label]));
  const taken = overview.staff
    .filter((s) => s.account !== null && s.userId !== null)
    .map((s) => ({ account: s.account!, userId: s.userId!, staffName: s.staffName }));

  return (
    <>
      <ul className="grid gap-3 sm:grid-cols-2">
        {overview.accounts.map((a) => (
          <li key={a.id} className="space-y-1 rounded-lg border p-4">
            <p className="font-semibold">{a.label}</p>
            <p className="text-sm">{t("accountStaff", { count: a.staffCount })}</p>
            <p className="text-sm">{t("accountServices", { count: a.servicesLinked })}</p>
            <p className={a.key === "missing" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
              {a.key === "fake" ? t("keyFake") : a.key === "ok" ? t("keyOk") : t("keyMissing", { env: a.keyEnv })}
            </p>
          </li>
        ))}
      </ul>

      <KoiboxMatchPanel accountLabels={accountLabels} />

      <div className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{t("staffTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("staffIntro")}</p>
        </div>
        {overview.staff.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noStaff")}</p>
        ) : (
          <ul className="space-y-3">
            {overview.staff.map((s) => (
              <StaffKoiboxRow
                key={s.staffId}
                staffId={s.staffId}
                name={s.staffName}
                account={s.account}
                userId={s.userId}
                unknownAccount={s.unknownAccount}
                missingServices={s.missingServices}
                accounts={accounts}
                taken={taken}
              />
            ))}
          </ul>
        )}
      <div className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{t("servicesTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("servicesIntro")}</p>
        </div>
        {services.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noServices")}</p>
        ) : (
          <ul className="space-y-3">
            {services.map((s) => (
              <ServiceKoiboxRow
                key={s.serviceId}
                serviceId={s.serviceId}
                name={s.name}
                durationMin={s.durationMin}
                accounts={s.accounts.map((a) => ({ ...a, label: accountLabels[a.account] ?? a.account }))}
              />
            ))}
          </ul>
        )}
      </div>
      </div>
    </>
  );
}
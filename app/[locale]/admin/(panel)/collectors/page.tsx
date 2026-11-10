import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PanelSkeleton } from "@/components/admin/panel-skeleton";
import { StaffCollectorRow } from "@/components/admin/staff-collector-row";
import { salonCollectors } from "@/lib/collectors";
import { listStaffCollectors } from "@/lib/collectors-db";
import { writesToKoibox } from "@/lib/koibox-sync";
import { loadSalonConfig } from "@/lib/salon-config";
import { requireStaff } from "@/lib/session";

type Props = { params: Promise<{ locale: string }> };

export default async function CollectorsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Admin.collectors" });

  return (
    <section className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      </div>
      <Suspense fallback={<PanelSkeleton />}>
        <CollectorsContent locale={locale} />
      </Suspense>
    </section>
  );
}

async function CollectorsContent({ locale }: { locale: string }) {
  await requireStaff(locale, "settings.manage");
  const [config, t] = await Promise.all([
    loadSalonConfig(),
    getTranslations({ locale, namespace: "Admin.collectors" }),
  ]);

  const { defaultId, byId } = salonCollectors(config);
  const collectors = [...byId.values()];
  const koibox = writesToKoibox(config);
  const rows = (await listStaffCollectors(config)).filter((r) => r.active);

  const accountLabel = (id: string) => config.koibox.accounts[id]?.label ?? id;
  const namesOrNone = (names: string[]) => (names.length > 0 ? names.join(", ") : t("none"));

  return (
    <>
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">{t("collectorsTitle")}</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {collectors.map((c) => {
            // ¿Número propio en el config o el de recepción (contact.whatsapp)?
            const own = Boolean(config.payments.collectors[c.id]?.deposit?.whatsapp);
            const accounts = Object.entries(config.koibox.accounts)
              .filter(([, a]) => a.collector === c.id)
              .map(([, a]) => a.label);
            const staffNames = rows.filter((r) => r.choice.collector.id === c.id).map((r) => r.staffName);

            return (
              <li key={c.id} className="space-y-3 rounded-lg border p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold">{c.label}</p>
                  {c.id === defaultId && collectors.length > 1 && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {t("default")}
                    </span>
                  )}
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                  <dt className="text-muted-foreground">{t("howLabel")}</dt>
                  <dd>{t(`mode.${c.deposit.mode}`)}</dd>
                  {c.deposit.mode === "whatsapp" && (
                    <>
                      <dt className="text-muted-foreground">{t("numberLabel")}</dt>
                      <dd>
                        {c.deposit.whatsapp
                          ? t(own ? "ownNumber" : "receptionNumber", { number: c.deposit.whatsapp })
                          : t("noNumber")}
                      </dd>
                    </>
                  )}
                  {koibox && (
                    <>
                      <dt className="text-muted-foreground">{t("accountsLabel")}</dt>
                      <dd>{namesOrNone(accounts)}</dd>
                    </>
                  )}
                  <dt className="text-muted-foreground">{t("staffLabel")}</dt>
                  <dd>{namesOrNone(staffNames)}</dd>
                </dl>
              </li>
            );
          })}
        </ul>
        <p className="text-sm text-muted-foreground">{t("configNote")}</p>
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">{t("staffTitle")}</h2>
        {collectors.length < 2 ? (
          <p className="text-sm text-muted-foreground">{t("single", { name: collectors[0].label })}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noStaff")}</p>
        ) : (
          <>
            <ul className="space-y-3">
              {rows.map((r) => (
                <StaffCollectorRow
                  key={r.staffId}
                  staffId={r.staffId}
                  name={r.staffName}
                  detail={koibox ? (r.koiboxAccount ? accountLabel(r.koiboxAccount) : t("noAccount")) : null}
                  saved={r.choice.source === "staff" ? r.saved : null}
                  currentLabel={r.choice.collector.label}
                  source={r.choice.source}
                  ignored={r.choice.ignored}
                  fallbackLabel={r.fallback.label}
                  followKey={koibox ? "followAccount" : "followDefault"}
                  collectors={collectors.map((c) => ({ id: c.id, label: c.label }))}
                />
              ))}
            </ul>
            <p className="text-sm text-muted-foreground">{t(koibox ? "footnote" : "footnoteLocal")}</p>
          </>
        )}
      </div>
    </>
  );
}
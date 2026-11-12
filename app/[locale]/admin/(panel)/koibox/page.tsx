import { Suspense } from "react";
import { notFound } from "next/navigation";
import { io } from "next/cache";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { KoiboxMatchPanel } from "@/components/admin/koibox-match-panel";
import { PanelTabs } from "@/components/admin/panel-tabs";
import { Dot, PageHeader, StatusPill, Surface } from "@/components/admin/panel-ui";
import { PanelSkeleton } from "@/components/admin/panel-skeleton";
import { RetryAllKoiboxButton } from "@/components/admin/retry-all-koibox-button";
import { RetryKoiboxButton } from "@/components/admin/retry-koibox-button";
import { ServiceKoiboxRow } from "@/components/admin/service-koibox-row";
import { StaffKoiboxDialog } from "@/components/admin/staff-koibox-dialog";
import { chooseCollector } from "@/lib/collectors";
import { listStaffCollectors } from "@/lib/collectors-db";
import { formatDateTime, formatTime } from "@/lib/format";
import { koiboxWorkKey } from "@/lib/koibox/card-state";
import { koiboxAccountStatus, type AccountStatus } from "@/lib/koibox/catalog";
import { loadKoiboxOverview, loadServiceLinks } from "@/lib/koibox-links-db";
import { findPendingKoiboxWork, writesToKoibox } from "@/lib/koibox-sync";
import { loadSalonConfig } from "@/lib/salon-config";
import { requireStaff } from "@/lib/session";
import { cn } from "@/lib/utils";

type Props = { params: Promise<{ locale: string }> };

export default async function KoiboxPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Admin.koibox" });

  return (
    <section className="space-y-6">
      <PageHeader title={t("title")} description={t("intro")} />
      <Suspense fallback={<PanelSkeleton />}>
        <KoiboxContent locale={locale} />
      </Suspense>
    </section>
  );
}

// Celdas de tabla en ordenador; en el móvil, bloques apilados (cada fila parece una tarjeta)
const th = "border-b px-4 py-3 font-medium";
const cell = "block px-4 md:table-cell md:border-b md:py-3.5 md:align-middle";
const mobileLabel = "text-muted-foreground md:hidden";

async function KoiboxContent({ locale }: { locale: string }) {
  await requireStaff(locale, "settings.manage");
  const [config, t, tCol, tK] = await Promise.all([
    loadSalonConfig(),
    getTranslations({ locale, namespace: "Admin.koibox" }),
    getTranslations({ locale, namespace: "Admin.collectors" }),
    getTranslations({ locale, namespace: "Admin.card.koibox" }),
  ]);
  // Un salón sin Koibox no tiene esta pantalla
  if (!writesToKoibox(config)) notFound();

  // La hora actual cambia en cada visita: se excluye del prerenderizado con io() antes de leerla
  await io();
  const now = new Date();
  const zone = config.timezone;

  const [overview, services, collectorRows, pending] = await Promise.all([
    loadKoiboxOverview(config),
    loadServiceLinks(config),
    listStaffCollectors(config),
    findPendingKoiboxWork(now),
  ]);
  // Estado de cada cuenta (en caché unos minutos). Sin clave no se pregunta.
  const status = new Map<string, AccountStatus | null>(
    await Promise.all(
      overview.accounts.map(async (a) => [a.id, a.key === "missing" ? null : await koiboxAccountStatus(a.id)] as const),
    ),
  );

  const accounts = overview.accounts.map((a) => ({ id: a.id, label: a.label }));
  const accountLabels = Object.fromEntries(accounts.map((a) => [a.id, a.label]));
  const accountLabel = (id: string) => accountLabels[id] ?? id;
  // Cada cuenta se pinta con el color de su cobrador
  const accountCollector = (id: string) => chooseCollector(config, { koiboxAccount: id }).collector;
  const usersByAccount = Object.fromEntries(
    overview.accounts.map((a) => {
      const s = status.get(a.id);
      return [a.id, s?.ok ? s.catalog.users : null];
    }),
  );
  const taken = overview.staff
    .filter((s) => s.account !== null && s.userId !== null)
    .map((s) => ({ account: s.account!, userId: s.userId!, staffName: s.staffName }));
  const collectorOf = new Map(collectorRows.map((r) => [r.staffId, r.choice]));

  // ---- Profesionales ----
  const staffPanel =
    overview.staff.length === 0 ? (
      <p className="text-sm text-muted-foreground">{t("noStaff")}</p>
    ) : (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{t("staffIntro")}</p>
        <div className="overflow-hidden rounded-xl border bg-card">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{t("staffTitle")}</caption>
            <thead className="hidden md:table-header-group">
              <tr className="text-left text-xs tracking-[0.06em] text-muted-foreground uppercase">
                <th scope="col" className={th}>{t("table.staff")}</th>
                <th scope="col" className={th}>{t("table.account")}</th>
                <th scope="col" className={th}>{t("table.user")}</th>
                <th scope="col" className={th}>{t("table.collector")}</th>
                <th scope="col" className={th}>
                  <span className="sr-only">{t("edit")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {overview.staff.map((s) => {
                const userName =
                  s.account && s.userId !== null
                    ? usersByAccount[s.account]?.find((u) => u.id === s.userId)?.name
                    : undefined;
                const choice = collectorOf.get(s.staffId);
                return (
                  <tr
                    key={s.staffId}
                    className="block space-y-2 border-b py-4 last:border-b-0 md:table-row md:space-y-0 md:py-0 md:[&:last-child>td]:border-b-0"
                  >
                    <td className={cell}>
                      <p className="font-medium">{s.staffName}</p>
                      {s.unknownAccount && (
                        <p className="text-xs text-danger">{t("unknownAccount", { account: s.account ?? "" })}</p>
                      )}
                      {s.missingServices.length > 0 && (
                        <p className="text-xs text-danger">
                          {t("missingServices", { services: s.missingServices.join(", ") })}
                        </p>
                      )}
                    </td>
                    <td className={cn(cell, "md:whitespace-nowrap")}>
                      <span className={mobileLabel}>{t("table.account")}: </span>
                      {s.account ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Dot color={s.unknownAccount ? null : accountCollector(s.account).color} />
                          {accountLabel(s.account)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{t("noAccount")}</span>
                      )}
                    </td>
                    <td className={cell}>
                      <span className={mobileLabel}>{t("table.user")}: </span>
                      {s.account && s.userId !== null ? (
                        userName ? t("userNamed", { name: userName, id: s.userId }) : t("userId", { id: s.userId })
                      ) : (
                        <StatusPill tone="bad">{t("notLinkedShort")}</StatusPill>
                      )}
                    </td>
                    <td className={cell}>
                      {choice && (
                        <>
                          <p>
                            <span className={mobileLabel}>{t("table.collector")}: </span>
                            {choice.collector.label}
                          </p>
                          <p className="text-xs text-muted-foreground">{tCol(`source.${choice.source}`)}</p>
                        </>
                      )}
                    </td>
                    <td className={cn(cell, "md:text-right")}>
                      <StaffKoiboxDialog
                        staffId={s.staffId}
                        name={s.staffName}
                        account={s.account}
                        userId={s.userId}
                        accounts={accounts}
                        usersByAccount={usersByAccount}
                        taken={taken}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );

  // ---- Servicios (se rehace en la D4b) ----
  const servicesPanel =
    services.length === 0 ? (
      <p className="text-sm text-muted-foreground">{t("noServices")}</p>
    ) : (
      <div className="max-w-3xl space-y-3">
        <p className="text-sm text-muted-foreground">{t("servicesIntro")}</p>
        <ul className="space-y-3">
          {services.map((s) => (
            <ServiceKoiboxRow
              key={s.serviceId}
              serviceId={s.serviceId}
              name={s.name}
              durationMin={s.durationMin}
              accounts={s.accounts.map((a) => ({ ...a, label: accountLabel(a.account) }))}
            />
          ))}
        </ul>
      </div>
    );

  // ---- Pendiente ----
  const pendingPanel =
    pending.length === 0 ? (
      <p className="text-sm text-muted-foreground">{t("pendingEmpty")}</p>
    ) : (
      <Surface className="space-y-1 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-2">
          <div>
            <h2 className="text-lg font-semibold">{t("pendingTitle", { count: pending.length })}</h2>
            <p className="text-sm text-muted-foreground">{tK("auto")}</p>
          </div>
          <RetryAllKoiboxButton />
        </div>
        <ul>
          {pending.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 border-t py-3">
              <div className="min-w-0 flex-[1_1_28rem] space-y-0.5 text-sm">
                <p className="font-medium">
                  {t("pendingItem", { id: p.id, name: p.clientName, when: formatDateTime(p.startsAt, locale, zone) })}
                </p>
                <p className="text-muted-foreground">{tK(`work.${koiboxWorkKey(p.work)}`)}</p>
                {p.lastError && <p className="text-danger">{tK("lastError", { error: p.lastError })}</p>}
              </div>
              <RetryKoiboxButton appointmentId={p.id} />
            </li>
          ))}
        </ul>
      </Surface>
    );

  return (
    <>
      <ul className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(16.25rem,1fr))]">
        {overview.accounts.map((a) => {
          const s = status.get(a.id) ?? null;
          const collector = accountCollector(a.id);
          return (
            <li key={a.id} className="flex flex-col gap-2 rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="inline-flex min-w-0 items-center gap-2 font-semibold">
                  <Dot color={collector.color} />
                  {a.label}
                </p>
                <StatusPill tone={s?.ok ? "ok" : "bad"}>
                  {s === null ? t("status.noKey") : s.ok ? t("status.ok") : t(`status.${s.reason}`)}
                </StatusPill>
              </div>
              <p className="text-sm text-muted-foreground">{t("collects", { name: collector.label })}</p>
              <p className="text-sm text-muted-foreground">
                {t("accountStaff", { count: a.staffCount })} · {t("accountServices", { count: a.servicesLinked })}
              </p>
              {s === null ? (
                <p className="text-sm text-danger">{t("keyMissing", { env: a.keyEnv })}</p>
              ) : s.ok ? (
                <p className="text-xs text-muted-foreground">
                  {a.key === "fake" ? `${t("keyFake")} · ` : ""}
                  {t("checkedAt", { time: formatTime(new Date(s.checkedAt), locale, zone) })}
                </p>
              ) : (
                <p className="text-sm text-danger">
                  {t(`statusDetail.${s.reason}`, { message: s.message, env: a.keyEnv })}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <PanelTabs
        label={t("tabsLabel")}
        tabs={[
          { id: "staff", label: t("tabs.staff", { count: overview.staff.length }), content: staffPanel },
          { id: "services", label: t("tabs.services", { count: services.length }), content: servicesPanel },
          { id: "pending", label: t("tabs.pending", { count: pending.length }), content: pendingPanel },
        ]}
      />

      {/* Se va a su propia página en la D4b */}
      <KoiboxMatchPanel accountLabels={accountLabels} />
    </>
  );
}
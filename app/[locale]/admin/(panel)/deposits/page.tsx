import { Suspense } from "react";
import { io } from "next/cache";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppointmentCard } from "@/components/admin/appointment-card";
import { PanelSkeleton } from "@/components/admin/panel-skeleton";
import { hasSeveralCollectors, resolveCollector } from "@/lib/collectors";
import { expireOverdueDeposits, listDeposits } from "@/lib/deposit-db";
import { can } from "@/lib/permissions";
import { loadSalonConfig } from "@/lib/salon-config";
import { requireStaff } from "@/lib/session";
import { PageHeader } from "@/components/admin/panel-ui";

type Props = { params: Promise<{ locale: string }> };

export default async function DepositsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Admin.deposits" });

  return (
    <section className="mx-auto max-w-3xl space-y-8">
      <PageHeader title={t("title")} description={t("intro")} />
      <Suspense fallback={<PanelSkeleton />}>
        <DepositsContent locale={locale} />
      </Suspense>
    </section>
  );
}

async function DepositsContent({ locale }: { locale: string }) {
  const { role } = await requireStaff(locale, "deposits.manage");
  // Antes de listar, se liberan las que ya vencieron para que no salgan como pendientes
  await expireOverdueDeposits();

  const [config, t, pending, expired] = await Promise.all([
    loadSalonConfig(),
    getTranslations({ locale, namespace: "Admin.deposits" }),
    listDeposits("pending_deposit"),
    listDeposits("expired", { sinceDays: 14 }),
  ]);
  // La hora actual cambia en cada visita: se excluye del prerenderizado con io() antes de leerla
  await io();
  const now = new Date().getTime();

  // Con varias titulares, cada tarjeta dice a quién se paga (docs/collectors.md)
  const several = hasSeveralCollectors(config);
  const collectorLabel = (row: (typeof pending)[number]) =>
    several
      ? resolveCollector(config, { staffCollector: row.staffCollector, koiboxAccount: row.staffKoiboxAccount }).label
      : null;

  const card = (row: (typeof pending)[number], actionable: boolean) => (
    <AppointmentCard
      key={row.id}
      data={{ ...row, collectorLabel: collectorLabel(row) }}
      locale={locale}
      zone={config.timezone}
      currency={config.currency}
      salonName={config.name}
      phoneCountryCode={config.phoneCountryCode}
      now={now}
      actionable={actionable}
      canValidate={can(role, "deposits.manage")}
      canCancel={can(role, "appointments.manage")}
    />
  );

  return (
    <>
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">{t("pendingTitle")}</h2>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("pendingEmpty")}</p>
        ) : (
          <ul className="space-y-3">{pending.map((row) => card(row, true))}</ul>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">{t("expiredTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("expiredIntro")}</p>
        {expired.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("expiredEmpty")}</p>
        ) : (
          <ul className="space-y-3">{expired.map((row) => card(row, false))}</ul>
        )}
      </div>
    </>
  );
}
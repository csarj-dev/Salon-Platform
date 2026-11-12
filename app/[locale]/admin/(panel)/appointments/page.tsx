import { Suspense } from "react";
import { io } from "next/cache";
import { DateTime } from "luxon";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppointmentDetail } from "@/components/admin/appointment-detail";
import { KOIBOX_TONE, ROW_GRID_KOIBOX, ROW_GRID_PLAIN, STATUS_TONE } from "@/components/admin/appointment-marks";
import { AppointmentRow } from "@/components/admin/appointment-row";
import { AppointmentTabs } from "@/components/admin/appointment-tabs";
import { KoiboxPendingBox } from "@/components/admin/koibox-pending-box";
import { PageHeader, SectionLabel, SegmentLinks, StatusPill } from "@/components/admin/panel-ui";
import { PanelSkeleton } from "@/components/admin/panel-skeleton";
import { listAppointments, type AppointmentStatus } from "@/lib/appointment-list";
import { latestEmailByAppointment } from "@/lib/email/email-status";
import { formatDayLong } from "@/lib/format";
import { groupByDay } from "@/lib/group-by-day";
import { koiboxCardState } from "@/lib/koibox/card-state";
import { findPendingKoiboxWork, writesToKoibox } from "@/lib/koibox-sync";
import { can } from "@/lib/permissions";
import { loadSalonConfig } from "@/lib/salon-config";
import { requireStaff } from "@/lib/session";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string }>;
};

const TABS = ["upcoming", "past", "cancelled"] as const;
type Tab = (typeof TABS)[number];

const isTab = (v: string | undefined): v is Tab => TABS.some((t) => t === v);

export default async function AppointmentsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Admin.appointments" });
  const tabs = TABS.map((id) => ({ id, label: t(`tabs.${id}`) }));

  return (
    <section className="space-y-4">
      <PageHeader title={t("title")} />
      {/* Fuera del <Suspense> de la lista: al cambiar de pestaña no desaparecen ni saltan */}
      <Suspense
        fallback={
          <SegmentLinks
            label={t("tabsLabel")}
            items={tabs.map((tab) => ({ href: `/admin/appointments?tab=${tab.id}`, label: tab.label, active: false }))}
          />
        }
      >
        <AppointmentTabs label={t("tabsLabel")} tabs={tabs} />
      </Suspense>
      <Suspense fallback={<PanelSkeleton />}>
        <AppointmentsContent locale={locale} searchParams={searchParams} />
      </Suspense>
    </section>
  );
}

async function AppointmentsContent({
  locale,
  searchParams,
}: {
  locale: string;
  searchParams: Props["searchParams"];
}) {
  const { role } = await requireStaff(locale, "appointments.view");
  const { tab: rawTab } = await searchParams;
  const tab: Tab = isTab(rawTab) ? rawTab : "upcoming";

  const [config, t, tCard, tStatus, tK] = await Promise.all([
    loadSalonConfig(),
    getTranslations({ locale, namespace: "Admin.appointments" }),
    getTranslations({ locale, namespace: "Admin.card" }),
    getTranslations({ locale, namespace: "Admin.status" }),
    getTranslations({ locale, namespace: "Admin.card.koibox" }),
  ]);

  // La hora actual cambia en cada visita: se excluye del prerenderizado con io() antes de leerla
  await io();
  const now = new Date();
  const nowMs = now.getTime();
  // "Hoy" y los 30 días anteriores se cuentan en la zona del salón
  const startOfToday = DateTime.fromJSDate(now, { zone: config.timezone }).startOf("day");
  const thirtyDaysAgo = startOfToday.minus({ days: 30 });

  const query: Record<Tab, Parameters<typeof listAppointments>[0]> = {
    upcoming: {
      statuses: ["booked", "pending_deposit"] satisfies AppointmentStatus[],
      from: startOfToday.toJSDate(),
      order: "asc",
    },
    past: {
      statuses: ["booked", "completed", "no_show"] satisfies AppointmentStatus[],
      from: thirtyDaysAgo.toJSDate(),
      to: startOfToday.toJSDate(),
      order: "desc",
    },
    cancelled: {
      statuses: ["cancelled", "expired"] satisfies AppointmentStatus[],
      from: thirtyDaysAgo.toJSDate(),
      order: "desc",
    },
  };

  const koibox = writesToKoibox(config);
  const [rows, pendingKoibox] = await Promise.all([
    listAppointments(query[tab]),
    // Solo con Koibox: las citas que no están al día allí (lo mismo que mira el reintento automático)
    koibox ? findPendingKoiboxWork(now) : Promise.resolve([]),
  ]);
  const emails = await latestEmailByAppointment(rows.map((r) => r.id));
  const accountLabel = (id: string | null) => (id ? (config.koibox.accounts[id]?.label ?? id) : null);
  const groups = groupByDay(
    rows.map((r) => ({
      ...r,
      email: emails.get(r.id) ?? null,
      koibox: koibox ? koiboxCardState(r, now) : null,
      koiboxAccountLabel: accountLabel(r.koiboxAccount),
    })),
    config.timezone,
  );

  const grid = koibox ? ROW_GRID_KOIBOX : ROW_GRID_PLAIN;
  const headCell = "py-3";

  return (
    <div className="space-y-4">
      <KoiboxPendingBox
        items={pendingKoibox}
        locale={locale}
        zone={config.timezone}
        canRetry={can(role, "appointments.manage")}
      />

      {groups.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">{t(`empty.${tab}`)}</p>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className={cn("hidden border-b px-4 text-xs font-medium tracking-[0.06em] text-muted-foreground uppercase", grid)}>
            <span className={headCell}>{t("table.time")}</span>
            <span className={headCell}>{t("table.client")}</span>
            <span className={headCell}>{t("table.service")}</span>
            <span className={headCell}>{t("table.status")}</span>
            {koibox && <span className={headCell}>{t("table.koibox")}</span>}
            <span className="sr-only">{t("table.detail")}</span>
          </div>
          {groups.map((group) => (
            <section key={group.day}>
              <SectionLabel className="border-b bg-background px-4 py-2.5">
                {formatDayLong(group.date, locale, config.timezone)}
              </SectionLabel>
              <ul>
                {group.rows.map((row) => {
                  const k = row.koibox;
                  return (
                    <AppointmentRow
                      key={row.id}
                      grid={grid}
                      time={formatTime(row.startsAt, locale, config.timezone)}
                      client={row.clientName}
                      phone={row.clientPhone}
                      service={row.serviceName}
                      sub={`${tCard("with", { staff: row.staffName })} · ${tCard("reference", { id: row.id })}`}
                      status={<StatusPill tone={STATUS_TONE[row.status]}>{tStatus(row.status)}</StatusPill>}
                      koibox={
                        !koibox ? null : k ? (
                          <span className="inline-flex items-center gap-2 text-sm">
                            <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", KOIBOX_TONE[k.kind].dot)} />
                            {tK(`short.${k.kind === "synced" && k.cancelled ? "cancelled" : k.kind}`)}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )
                      }
                      labels={{
                        show: tCard("showDetail", { id: row.id }),
                        hide: tCard("hideDetail", { id: row.id }),
                      }}
                    >
                      <AppointmentDetail
                        data={row}
                        locale={locale}
                        zone={config.timezone}
                        currency={config.currency}
                        salonName={config.name}
                        phoneCountryCode={config.phoneCountryCode}
                        now={nowMs}
                        actionable={tab === "upcoming"}
                        canValidate={can(role, "deposits.manage")}
                        canCancel={can(role, "appointments.manage")}
                        canResend={can(role, "appointments.manage")}
                        canRetryKoibox={can(role, "appointments.manage")}
                        layout="columns"
                      />
                    </AppointmentRow>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
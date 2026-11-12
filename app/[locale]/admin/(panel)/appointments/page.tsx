import { Suspense, type ReactNode } from "react";
import { io } from "next/cache";
import { DateTime } from "luxon";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppointmentDetail } from "@/components/admin/appointment-detail";
import { AppointmentFilters } from "@/components/admin/appointment-filters";
import { KOIBOX_TONE, ROW_GRID_KOIBOX, ROW_GRID_PLAIN, STATUS_TONE } from "@/components/admin/appointment-marks";
import { AppointmentRow } from "@/components/admin/appointment-row";
import { AppointmentTabs } from "@/components/admin/appointment-tabs";
import { KoiboxPendingBox } from "@/components/admin/koibox-pending-box";
import { PageHeader, SectionLabel, SegmentLinks, StatusPill, textAction } from "@/components/admin/panel-ui";
import { PanelSkeleton } from "@/components/admin/panel-skeleton";
import { Link } from "@/i18n/navigation";
import {
  appointmentSummary,
  clientSummary,
  listAppointments,
  listFilterOptions,
  type AppointmentStatus,
} from "@/lib/appointment-list";
import { latestEmailByAppointment } from "@/lib/email/email-status";
import { formatDayLong, formatTime } from "@/lib/format";
import { groupByDay } from "@/lib/group-by-day";
import { initialsOf } from "@/lib/initials";
import { koiboxCardState } from "@/lib/koibox/card-state";
import { findPendingKoiboxWork, writesToKoibox } from "@/lib/koibox-sync";
import { can } from "@/lib/permissions";
import { loadSalonConfig } from "@/lib/salon-config";
import { requireStaff } from "@/lib/session";
import { cn } from "@/lib/utils";

type SearchParams = {
  tab?: string;
  q?: string;
  staff?: string;
  location?: string;
  client?: string;
  day?: string; // "today" | "week": los recuadros del resumen
};

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
};

const TABS = ["upcoming", "past", "cancelled"] as const;
type Tab = (typeof TABS)[number];

const isTab = (v: string | undefined): v is Tab => TABS.some((t) => t === v);

const ALL_STATUSES: AppointmentStatus[] = ["booked", "pending_deposit", "completed", "cancelled", "no_show", "expired"];
const ACTIVE_STATUSES: AppointmentStatus[] = ["booked", "pending_deposit"];

// Un id de la URL: entero positivo que cabe en la columna (si no, se ignora)
const positiveId = (v: string | undefined) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 2_147_483_647 ? n : undefined;
};

export default async function AppointmentsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Admin.appointments" });
  const tabs = TABS.map((id) => ({ id, label: t(`tabs.${id}`) }));

  return (
    <section className="space-y-4">
      <PageHeader title={t("title")} />
      <div className="space-y-3">
        {/* Pestañas y búsqueda, fuera del <Suspense> de la lista: al cambiar no saltan ni se pierde lo escrito */}
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
        <Suspense fallback={<div className="h-11" />}>
          <FiltersLoader locale={locale} />
        </Suspense>
      </div>
      <Suspense fallback={<PanelSkeleton />}>
        <AppointmentsContent locale={locale} searchParams={searchParams} />
      </Suspense>
    </section>
  );
}

async function FiltersLoader({ locale }: { locale: string }) {
  await requireStaff(locale, "appointments.view");
  const [options, t] = await Promise.all([
    listFilterOptions(),
    getTranslations({ locale, namespace: "Admin.appointments.filters" }),
  ]);
  return (
    <AppointmentFilters
      staff={options.staff}
      locations={options.locations}
      labels={{
        search: t("search"),
        searchPlaceholder: t("searchPlaceholder"),
        staff: t("staff"),
        allStaff: t("allStaff"),
        location: t("location"),
        allLocations: t("allLocations"),
        searching: t("searching"),
      }}
    />
  );
}

type Tile = {
  key: string;
  href?: string; // sin enlace si no tiene permiso para ir allí
  label: string;
  value: string;
  valueTone?: string;
  sub?: string;
  subTone?: string;
  active?: boolean;
};

async function AppointmentsContent({
  locale,
  searchParams,
}: {
  locale: string;
  searchParams: Props["searchParams"];
}) {
  const { role } = await requireStaff(locale, "appointments.view");
  const sp = await searchParams;
  const tab: Tab = isTab(sp.tab) ? sp.tab : "upcoming";
  const search = (sp.q ?? "").trim().slice(0, 100) || undefined;
  const staffId = positiveId(sp.staff);
  const locationId = positiveId(sp.location);
  const clientId = positiveId(sp.client);
  const day = sp.day === "today" || sp.day === "week" ? sp.day : undefined;

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
  const zone = config.timezone;
  // "Hoy", la semana y los 30 días anteriores se cuentan en la zona del salón
  const startOfToday = DateTime.fromJSDate(now, { zone }).startOf("day");
  const thirtyDaysAgo = startOfToday.minus({ days: 30 });
  const endOfToday = startOfToday.plus({ days: 1 });
  const weekEnd = startOfToday.plus({ days: 7 });

  const query: Record<Tab, Parameters<typeof listAppointments>[0]> = {
    upcoming: { statuses: ACTIVE_STATUSES, from: startOfToday.toJSDate(), order: "asc" },
    past: {
      statuses: ["booked", "completed", "no_show"],
      from: thirtyDaysAgo.toJSDate(),
      to: startOfToday.toJSDate(),
      order: "desc",
    },
    cancelled: { statuses: ["cancelled", "expired"], from: thirtyDaysAgo.toJSDate(), order: "desc" },
  };
  // "Hoy" y "Próximos 7 días" (recuadros del resumen): las próximas, acotadas a ese tramo
  const listOptions = day
    ? { ...query.upcoming, to: (day === "today" ? endOfToday : weekEnd).toJSDate() }
    : query[tab];

  const koibox = writesToKoibox(config);
  const [rows, pendingKoibox, summary, client] = await Promise.all([
    clientId
      ? listAppointments({ statuses: ALL_STATUSES, order: "asc", clientId, limit: 500 })
      : listAppointments({ ...listOptions, search, staffId, locationId }),
    // Solo con Koibox: las citas que no están al día allí (lo mismo que mira el reintento automático)
    koibox ? findPendingKoiboxWork(now) : Promise.resolve([]),
    appointmentSummary({
      dayStart: startOfToday.toJSDate(),
      dayEnd: endOfToday.toJSDate(),
      weekEnd: weekEnd.toJSDate(),
      soon: new Date(nowMs + 3 * 3_600_000),
    }),
    clientId ? clientSummary(clientId, now) : Promise.resolve(null),
  ]);

  const emails = await latestEmailByAppointment(rows.map((r) => r.id));
  const accountLabel = (id: string | null) => (id ? (config.koibox.accounts[id]?.label ?? id) : null);
  const enriched = rows.map((r) => ({
    ...r,
    email: emails.get(r.id) ?? null,
    koibox: koibox ? koiboxCardState(r, now) : null,
    koiboxAccountLabel: accountLabel(r.koiboxAccount),
  }));
  type Row = (typeof enriched)[number];

  const grid = koibox ? ROW_GRID_KOIBOX : ROW_GRID_PLAIN;
  const headCell = "py-3";

  const table = (list: Row[]): ReactNode => (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className={cn("hidden border-b px-4 text-xs font-medium tracking-[0.06em] text-muted-foreground uppercase", grid)}>
        <span className={headCell}>{t("table.time")}</span>
        <span className={headCell}>{t("table.client")}</span>
        <span className={headCell}>{t("table.service")}</span>
        <span className={headCell}>{t("table.status")}</span>
        {koibox && <span className={headCell}>{t("table.koibox")}</span>}
        <span className="sr-only">{t("table.detail")}</span>
      </div>
      {groupByDay(list, zone).map((group) => (
        <section key={group.day}>
          <SectionLabel className="border-b bg-background px-4 py-2.5">
            {formatDayLong(group.date, locale, zone)}
          </SectionLabel>
          <ul>
            {group.rows.map((row) => {
              const k = row.koibox;
              return (
                <AppointmentRow
                  key={row.id}
                  grid={grid}
                  time={formatTime(row.startsAt, locale, zone)}
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
                    zone={zone}
                    currency={config.currency}
                    salonName={config.name}
                    phoneCountryCode={config.phoneCountryCode}
                    now={nowMs}
                    // Se puede gestionar si aún no ha pasado o si espera el depósito (la ficha decide qué botones)
                    actionable={row.status === "pending_deposit" || row.startsAt.getTime() > nowMs}
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
  );

  // ---- "Todas las citas de una clienta" ----
  if (clientId) {
    if (!client) {
      return (
        <p className="text-sm text-muted-foreground">
          {t("client.notFound")}{" "}
          <Link href="/admin/appointments" className="font-medium text-foreground underline-offset-4 hover:underline">
            {t("client.clear")}
          </Link>
        </p>
      );
    }
    const todayMs = startOfToday.toMillis();
    const upcoming = enriched.filter((r) => ACTIVE_STATUSES.includes(r.status) && r.startsAt.getTime() >= todayMs);
    const previous = enriched.filter((r) => !upcoming.includes(r)).reverse();
    const stats = [
      { label: t("client.total"), value: client.total },
      { label: t("client.upcoming"), value: client.upcoming },
      { label: t("client.cancelled"), value: client.cancelled },
      { label: t("client.noShow"), value: client.noShow },
    ];

    return (
      <div className="space-y-5">
        <section className="flex flex-wrap items-center gap-5 rounded-xl border bg-card p-5">
          <div className="flex min-w-0 flex-[1_1_18rem] items-center gap-3.5">
            <span
              aria-hidden
              className="inline-flex size-14 shrink-0 items-center justify-center rounded-full bg-muted text-lg font-semibold"
            >
              {initialsOf(client.name)}
            </span>
            <div className="min-w-0">
              <h2 className="text-xl font-semibold">{client.name}</h2>
              <p className="text-sm text-muted-foreground">
                {client.phone}
                {client.email ? ` · ${client.email}` : ""}
              </p>
              {client.firstAt && (
                <p className="text-xs text-muted-foreground">
                  {t("client.since", { date: formatDayLong(client.firstAt, locale, zone) })}
                </p>
              )}
            </div>
          </div>
          <dl className="grid flex-[1_1_24rem] grid-cols-2 gap-2.5 sm:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="rounded-lg bg-background p-3">
                <dt className="text-xs text-muted-foreground">{s.label}</dt>
                <dd className="text-xl font-semibold">{s.value}</dd>
              </div>
            ))}
          </dl>
          <Link href="/admin/appointments" className={textAction()}>
            ← {t("client.clear")}
          </Link>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">{t("client.upcomingTitle")}</h2>
          {upcoming.length > 0 ? table(upcoming) : <p className="text-sm text-muted-foreground">{t("client.noneUpcoming")}</p>}
        </section>
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">{t("client.previousTitle")}</h2>
          {previous.length > 0 ? table(previous) : <p className="text-sm text-muted-foreground">{t("client.nonePrevious")}</p>}
        </section>
      </div>
    );
  }

  // ---- Lista normal ----
  const canSettings = can(role, "settings.manage");
  const tiles: Tile[] = [
    {
      key: "today",
      href: "/admin/appointments?tab=upcoming&day=today",
      label: t("summary.today"),
      value: t("summary.count", { count: summary.today }),
      sub:
        summary.todayFirst && summary.todayLast
          ? t("summary.range", {
              first: formatTime(summary.todayFirst, locale, zone),
              last: formatTime(summary.todayLast, locale, zone),
            })
          : t("summary.none"),
      active: day === "today",
    },
    {
      key: "deposits",
      href: "/admin/deposits",
      label: t("summary.deposits"),
      value: String(summary.pendingDeposits),
      valueTone: summary.pendingDeposits > 0 ? "text-warning" : undefined,
      sub: summary.depositsDueSoon > 0 ? t("summary.dueSoon", { count: summary.depositsDueSoon }) : t("summary.noneUrgent"),
      subTone: summary.depositsDueSoon > 0 ? "font-medium text-danger" : undefined,
    },
    ...(koibox
      ? [
          {
            key: "koibox",
            href: canSettings ? "/admin/koibox" : undefined,
            label: t("summary.koibox"),
            value: String(pendingKoibox.length),
            valueTone: pendingKoibox.length > 0 ? "text-danger" : undefined,
            sub: tK("auto"),
          },
        ]
      : []),
    {
      key: "week",
      href: "/admin/appointments?tab=upcoming&day=week",
      label: t("summary.week"),
      value: t("summary.count", { count: summary.week }),
      active: day === "week",
    },
  ];

  const tileClass = (active?: boolean) =>
    cn(
      "flex h-full flex-col gap-0.5 rounded-xl border bg-card px-3 py-2.5 sm:px-4 sm:py-3.5",
      active && "border-foreground",
    );
  const tileBody = (tile: Tile) => (
    <>
      <span className="text-sm text-muted-foreground">{tile.label}</span>
      <span className={cn("text-xl font-semibold sm:text-2xl", tile.valueTone)}>{tile.value}</span>
      {tile.sub && <span className={cn("text-xs text-muted-foreground", tile.subTone)}>{tile.sub}</span>}
    </>
  );

  const filtered = Boolean(search || staffId || locationId || day);
  const clearHref = `/admin/appointments?tab=${day ? "upcoming" : tab}`;

  return (
    <div className="space-y-4">
      <ul
        aria-label={t("summary.label")}
        className="grid grid-cols-2 gap-3 lg:[grid-template-columns:repeat(auto-fit,minmax(12.5rem,1fr))]"
      >
        {tiles.map((tile) => (
          <li key={tile.key}>
            {tile.href ? (
              <Link
                href={tile.href}
                aria-current={tile.active ? "page" : undefined}
                className={cn(
                  tileClass(tile.active),
                  "outline-none transition-colors hover:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                {tileBody(tile)}
              </Link>
            ) : (
              <div className={tileClass()}>{tileBody(tile)}</div>
            )}
          </li>
        ))}
      </ul>

      <KoiboxPendingBox
        items={pendingKoibox}
        locale={locale}
        zone={zone}
        canRetry={can(role, "appointments.manage")}
      />

      {filtered && (
        <p className="text-sm text-muted-foreground">
          {t("filtered", { count: rows.length })}{" "}
          <Link href={clearHref} className="font-medium text-foreground underline-offset-4 hover:underline">
            {t("clearFilters")}
          </Link>
        </p>
      )}

      {enriched.length === 0
        ? !filtered && <p className="py-2 text-sm text-muted-foreground">{t(`empty.${tab}`)}</p>
        : table(enriched)}
    </div>
  );
}
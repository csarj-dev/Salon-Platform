import { Suspense } from "react";
import { io } from "next/cache";
import { DateTime } from "luxon";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AGENDA_STATUSES, duration, navBase, positiveId } from "@/components/admin/agenda-ui";
import { AppointmentsViewSwitch } from "@/components/admin/appointments-view-switch";
import { Dot, SegmentLinks } from "@/components/admin/panel-ui";
import { PanelSkeleton } from "@/components/admin/panel-skeleton";
import { Link } from "@/i18n/navigation";
import type { Interval } from "@/lib/availability";
import { loadAgendaWeek, type AgendaWeekRow } from "@/lib/agenda-db";
import { loadAgendaKoibox } from "@/lib/agenda-koibox";
import { daySummary, subtractIntervals, type DaySummary } from "@/lib/agenda-layout";
import { listAppointments, listFilterOptions } from "@/lib/appointment-list";
import { addMonths, isMonthKey, monthGrid, monthOfDay } from "@/lib/calendar";
import { chooseCollector } from "@/lib/collectors";
import { formatDayLong } from "@/lib/format";
import { can } from "@/lib/permissions";
import { loadSalonConfig } from "@/lib/salon-config";
import { requireStaff } from "@/lib/session";
import { cn } from "@/lib/utils";

type SearchParams = {
  month?: string; // "2026-11"; sin él, el mes de hoy
  location?: string;
};

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
};

export default async function AgendaMonthPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Admin.appointments" });

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <AppointmentsViewSwitch locale={locale} active="agenda" />
      </div>
      <Suspense fallback={<PanelSkeleton />}>
        <MonthContent locale={locale} searchParams={searchParams} />
      </Suspense>
    </section>
  );
}

// El mes: para planificar y ver de un vistazo dónde queda tiempo libre.
// Cada casilla resume el día de cada profesional con las mismas cuentas que la Semana.
async function MonthContent({ locale, searchParams }: { locale: string; searchParams: Props["searchParams"] }) {
  const { role } = await requireStaff(locale, "appointments.view");
  const sp = await searchParams;
  const [config, t, options] = await Promise.all([
    loadSalonConfig(),
    getTranslations({ locale, namespace: "Admin.agenda" }),
    listFilterOptions(),
  ]);

  // "Este mes" depende de la fecha: fuera del prerenderizado
  await io();
  const now = new Date();
  const zone = config.timezone;
  const today = DateTime.fromJSDate(now, { zone }).toISODate()!;
  const thisMonth = monthOfDay(today);
  const month = isMonthKey(sp.month) ? sp.month : thisMonth;
  const locationId = options.locations.find((l) => l.id === positiveId(sp.location))?.id;

  const first = DateTime.fromISO(`${month}-01`, { zone }).startOf("day");
  const range = { from: first.toISODate()!, to: first.endOf("month").toISODate()! };

  // ---- Citas del mes y turnos (los mismos que el Día, la Semana y la web) ----
  const appointments = await listAppointments({
    statuses: AGENDA_STATUSES,
    from: first.toJSDate(),
    to: first.plus({ months: 1 }).toJSDate(),
    order: "asc",
    locationId,
    limit: 2000,
  });
  const { koibox: koiboxData, down: koiboxDown } = await loadAgendaKoibox(config, range);
  const agenda = await loadAgendaWeek({
    ...range,
    zone,
    locationId,
    withAppointments: [...new Set(appointments.map((a) => a.staffId))],
    koibox: koiboxData,
  });

  // ---- Resumen de cada profesional cada día (como la casilla de la Semana) ----
  const localDate = (d: Date) => DateTime.fromJSDate(d, { zone }).toISODate()!;
  const busyByCell = new Map<string, Interval[]>();
  for (const a of appointments) {
    const key = `${a.staffId}|${localDate(a.startsAt)}`;
    busyByCell.set(key, [...(busyByCell.get(key) ?? []), { start: a.startsAt, end: a.endsAt }]);
  }
  const summaryOf = (row: AgendaWeekRow, date: string): DaySummary => {
    const day = row.days[agenda.dates.indexOf(date)];
    if (!day) return { kind: "off" };
    const ours = busyByCell.get(`${row.staffId}|${date}`) ?? [];
    // Lo que solo está en Koibox (creado allí) también ocupa
    const koiboxOnly = subtractIntervals(day.koiboxBusy, ours);
    return daySummary(day, [...ours, ...koiboxOnly]).summary;
  };
  const summaryText = (s: DaySummary) =>
    s.kind === "off"
      ? t("offDay")
      : s.kind === "absent"
        ? t("absent")
        : s.kind === "full"
          ? t("full")
          : t("freeSummary", { time: duration(s.minutes), many: s.minutes >= 120 ? "yes" : "no" });
  const accountColor = (account: string | null) =>
    account ? chooseCollector(config, { koiboxAccount: account }).collector.color : null;

  // ---- Enlaces: se conserva el local ----
  const query = (values: Record<string, string | null>) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) if (value) q.set(key, value);
    if (locationId) q.set("location", String(locationId));
    const qs = q.toString();
    return qs ? `?${qs}` : "";
  };
  const monthHref = (m: string) => `/admin/appointments/month${query({ month: m === thisMonth ? null : m })}`;
  const dayHref = (date: string) => `/admin/appointments${query({ date: date === today ? null : date })}`;
  const focusDay = month === thisMonth ? today : range.from; // el día al que llevan «Día» y «Semana»
  const weekHref = `/admin/appointments/week${query({ date: focusDay === today ? null : focusDay })}`;
  const canCreate = can(role, "appointments.manage");
  const newHref = `/admin/appointments${query({ date: focusDay === today ? null : focusDay, new: "1" })}`;
  const severalLocations = options.locations.length > 1;

  // ---- Título y cabecera de los días de la semana (lunes primero) ----
  const monthTitle = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: zone }).format(
    first.toJSDate(),
  );
  const monday = DateTime.fromISO("2026-11-02"); // un lunes cualquiera
  const weekdays = Array.from({ length: 7 }, (_, i) => monday.plus({ days: i }).setLocale(locale).toFormat("ccc"));

  const cell = (date: string) => {
    const past = date < today;
    const lines = past ? [] : agenda.rows.map((row) => ({ row, s: summaryOf(row, date) }));
    const nobody = !past && lines.every((l) => l.s.kind === "off");
    const dayName = formatDayLong(DateTime.fromISO(date, { zone }).toJSDate(), locale, zone);
    return (
      <Link
        key={date}
        href={dayHref(date)}
        aria-label={t("monthDayLabel", { day: dayName })}
        aria-current={date === today ? "date" : undefined}
        className={cn(
          "flex min-h-32 flex-col gap-1.5 border-b border-l p-2 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          past && "bg-muted/30 text-muted-foreground",
        )}
      >
        <span
          className={cn(
            "text-sm font-semibold tabular-nums",
            date === today && "inline-flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground",
          )}
        >
          {Number(date.slice(8))}
        </span>
        {nobody ? (
          <span className="text-xs text-muted-foreground">{t("nobodyDay")}</span>
        ) : (
          lines.map(({ row, s }) => (
            <span key={row.staffId} className="flex items-center justify-between gap-2 text-xs">
              <span className="flex min-w-0 items-center gap-1.5">
                <Dot color={s.kind === "off" ? null : accountColor(row.koiboxAccount)} />
                <span className={cn("truncate", s.kind === "off" && "text-muted-foreground")}>{row.staffName}</span>
              </span>
              <span
                className={cn(
                  "shrink-0 font-medium",
                  s.kind === "free" ? "text-success" : s.kind === "absent" ? "text-warning" : "text-muted-foreground",
                )}
              >
                {summaryText(s)}
              </span>
            </span>
          ))
        )}
      </Link>
    );
  };

  return (
    <div className="space-y-4">
      {/* ---- Barra: mes, vista y local ---- */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Link href={monthHref(addMonths(month, -1))} aria-label={t("previousMonth")} className={cn(navBase, "w-11 text-lg")}>
            ‹
          </Link>
          <Link
            href={monthHref(thisMonth)}
            aria-current={month === thisMonth ? "date" : undefined}
            className={cn(navBase, "px-3.5 text-sm")}
          >
            {t("thisMonth")}
          </Link>
          <Link href={monthHref(addMonths(month, 1))} aria-label={t("nextMonth")} className={cn(navBase, "w-11 text-lg")}>
            ›
          </Link>
        </div>
        <h2 className="text-lg font-semibold">{monthTitle.charAt(0).toLocaleUpperCase(locale) + monthTitle.slice(1)}</h2>
        {canCreate && (
          <Link href={newHref} className={cn(navBase, "px-3.5 text-sm")}>
            {t("newAppointment.open")}
          </Link>
        )}
        <div className="flex min-w-0 max-w-full flex-wrap gap-3 lg:ms-auto">
          <SegmentLinks
            label={t("viewLabel")}
            items={[
              { href: dayHref(focusDay), label: t("day"), active: false },
              { href: weekHref, label: t("week"), active: false },
              { href: monthHref(month), label: t("month"), active: true },
            ]}
          />
          {severalLocations && (
            <SegmentLinks
              label={t("locationsLabel")}
              items={[
                {
                  href: `/admin/appointments/month${month === thisMonth ? "" : `?month=${month}`}`,
                  label: t("allLocations"),
                  active: !locationId,
                },
                ...options.locations.map((l) => ({
                  href: `/admin/appointments/month?${new URLSearchParams({
                    ...(month === thisMonth ? {} : { month }),
                    location: String(l.id),
                  })}`,
                  label: l.name,
                  active: l.id === locationId,
                })),
              ]}
            />
          )}
        </div>
      </div>

      {koiboxDown && (
        <p role="status" className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          {t("koiboxDown")}
        </p>
      )}

      {/* ---- El mes: lunes a domingo; en el móvil se desliza de lado ---- */}
      <div className="overflow-x-auto rounded-xl border bg-card">
        <div className="grid min-w-[60rem] grid-cols-7" role="grid" aria-label={t("monthGridLabel", { month: monthTitle })}>
          {weekdays.map((w) => (
            <div key={w} className="border-b px-2 py-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {w}
            </div>
          ))}
          {monthGrid(month, 1)
            .flat()
            .map((date, i) =>
              date === null ? <div key={`empty-${i}`} className="min-h-32 border-b border-l bg-muted/40" /> : cell(date),
            )}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{t("monthHint")}</p>
    </div>
  );
}
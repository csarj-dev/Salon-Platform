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
import { KoiboxUnavailableError, getBookingAvailability } from "@/lib/availability-source";
import { loadAgendaWeek, type AgendaWeekRow } from "@/lib/agenda-db";
import { loadAgendaKoibox } from "@/lib/agenda-koibox";
import { daySummary, minutesOf, subtractIntervals, type DaySummary } from "@/lib/agenda-layout";
import { listAppointments, listFilterOptions } from "@/lib/appointment-list";
import { SERVICES_MAX } from "@/lib/booking-catalog";
import { addMonths, isMonthKey, monthGrid, monthOfDay } from "@/lib/calendar";
import { listServicesForLocation } from "@/lib/catalog";
import { chooseCollector } from "@/lib/collectors";
import { formatDayLong, formatDuration, formatTime } from "@/lib/format";
import { can } from "@/lib/permissions";
import { loadSalonConfig } from "@/lib/salon-config";
import { requireStaff } from "@/lib/session";
import { staffDoingAll } from "@/lib/service-set";
import { cn } from "@/lib/utils";

type SearchParams = {
  month?: string; // "2026-11"; sin él, el mes de hoy
  location?: string;
  svc?: string; // «Buscar hueco»: servicios marcados, "30,31"
  with?: string; // «Buscar hueco»: id de la profesional; sin él, cualquiera
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

const chip = (on: boolean) =>
  cn(
    "inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
    on ? "border-foreground bg-primary font-medium text-primary-foreground" : "bg-card hover:bg-muted",
  );

// El mes: para planificar y buscar dónde cabe una cita.
// Cada casilla resume el día de cada profesional con las mismas cuentas que la Semana;
// «Buscar hueco» marca los días donde caben los servicios, con el mismo cálculo que la web.
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

  // ---- «Buscar hueco»: en qué local, qué servicios y con quién ----
  // Los servicios y las profesionales dependen del local: el filtrado o, si solo hay uno, ese
  const searchLocation = locationId ?? (options.locations.length === 1 ? options.locations[0].id : undefined);
  const services = searchLocation ? await listServicesForLocation(searchLocation, locale, config.defaultLocale) : [];
  const wantedIds = new Set(
    (sp.svc ?? "")
      .split(",")
      .map((v) => positiveId(v))
      .filter((v): v is number => v !== undefined),
  );
  // En el orden de la carta, como en la reserva
  const chosen = services.filter((s) => wantedIds.has(s.id)).slice(0, SERVICES_MAX);
  const picked = chosen.map((s) => s.id);
  const withStaff: number | "any" = positiveId(sp.with) ?? "any";
  // Quiénes hacen todos los servicios marcados (las demás salen apagadas en «Con:»)
  const doers = new Set(picked.length > 0 ? await staffDoingAll(picked) : []);
  const notDoing = (staffId: number) => picked.length > 0 && !doers.has(staffId);

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

  // ---- Dónde caben los servicios elegidos (mismo cálculo que la reserva web) ----
  const fits = new Set<string>();
  let firstFit: { date: string; at: Date; staffId: number } | null = null;
  let searchDown = false;
  const fromDay = range.from < today ? today : range.from;
  if (searchLocation && picked.length > 0 && fromDay <= range.to) {
    try {
      const availability = await getBookingAvailability(config, searchLocation, picked, fromDay, range.to, now);
      for (const date of [...availability.keys()].sort()) {
        const a = availability.get(date)!;
        const slots =
          withStaff === "any"
            ? a.any.map((s) => ({ at: s.startsAt, staffId: s.staffIds[0] }))
            : (a.perStaff.find((p) => p.staffId === withStaff)?.slots ?? []).map((at) => ({ at, staffId: withStaff }));
        if (slots.length === 0) continue;
        fits.add(date);
        firstFit ??= { date, ...slots[0] };
      }
    } catch (error) {
      if (!(error instanceof KoiboxUnavailableError)) throw error;
      console.error(error);
      searchDown = true;
    }
  }

  // ---- Resumen de cada profesional cada día (como la casilla de la Semana) ----
  const localDate = (d: Date) => DateTime.fromJSDate(d, { zone }).toISODate()!;
  const busyByCell = new Map<string, Interval[]>();
  for (const a of appointments) {
    const key = `${a.staffId}|${localDate(a.startsAt)}`;
    busyByCell.set(key, [...(busyByCell.get(key) ?? []), { start: a.startsAt, end: a.endsAt }]);
  }
  const dayOf = (row: AgendaWeekRow, date: string) => {
    const day = row.days[agenda.dates.indexOf(date)];
    if (!day) return { summary: { kind: "off" } as DaySummary, free: [] as Interval[], shifts: [] as Interval[] };
    const ours = busyByCell.get(`${row.staffId}|${date}`) ?? [];
    // Lo que solo está en Koibox (creado allí) también ocupa
    const koiboxOnly = subtractIntervals(day.koiboxBusy, ours);
    return { ...daySummary(day, [...ours, ...koiboxOnly]), shifts: day.shifts as Interval[] };
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
  const time = (d: Date) => formatTime(d, locale, zone);

  // ---- Enlaces: se conservan el local y, en el mes, la búsqueda ----
  const query = (values: Record<string, string | null>) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) if (value) q.set(key, value);
    if (locationId) q.set("location", String(locationId));
    const qs = q.toString();
    return qs ? `?${qs}` : "";
  };
  const search = {
    svc: picked.length > 0 ? picked.join(",") : null,
    with: withStaff === "any" ? null : String(withStaff),
  };
  const monthHref = (m: string, changes: Partial<typeof search> = {}) =>
    `/admin/appointments/month${query({ month: m === thisMonth ? null : m, ...search, ...changes })}`;
  const toggleService = (id: number) => {
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    return monthHref(month, { svc: next.length > 0 ? next.join(",") : null });
  };
  const dayHref = (date: string) => `/admin/appointments${query({ date: date === today ? null : date })}`;
  const focusDay = month === thisMonth ? today : range.from; // el día al que llevan «Día» y «Semana»
  const weekHref = `/admin/appointments/week${query({ date: focusDay === today ? null : focusDay })}`;
  const canCreate = can(role, "appointments.manage");
  const newHref = `/admin/appointments${query({ date: focusDay === today ? null : focusDay, new: "1" })}`;
  // «Crear ahí»: el Día con «Nueva cita» abierto en esa profesional y esa hora
  const createHref = (fit: NonNullable<typeof firstFit>) =>
    `/admin/appointments${query({
      date: fit.date === today ? null : fit.date,
      new: `${fit.staffId}@${DateTime.fromJSDate(fit.at, { zone }).toFormat("HH:mm")}`,
      col: String(fit.staffId),
      svc: picked.join(","),
    })}`;
  const severalLocations = options.locations.length > 1;

  // ---- Lo que dice la búsqueda ----
  const totalMin = chosen.reduce((sum, s) => sum + s.durationMin, 0);
  const staffName = (id: number) => agenda.rows.find((r) => r.staffId === id)?.staffName ?? "";
  const searchText =
    picked.length === 0
      ? t("search.hint")
      : withStaff !== "any" && notDoing(withStaff)
        ? t("search.notDoing", { staff: staffName(withStaff) })
        : searchDown
        ? t("search.koiboxDown")
        : firstFit
          ? t("search.first", {
              day: formatDayLong(firstFit.at, locale, zone),
              time: time(firstFit.at),
              staff: staffName(firstFit.staffId),
              duration: formatDuration(totalMin),
            })
          : t("search.none");

  // ---- Título y cabecera de los días de la semana (lunes primero) ----
  const monthTitle = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: zone }).format(
    first.toJSDate(),
  );
  const monday = DateTime.fromISO("2026-11-02"); // un lunes cualquiera
  const weekdays = Array.from({ length: 7 }, (_, i) => monday.plus({ days: i }).setLocale(locale).toFormat("ccc"));
  // Con una profesional elegida en «Con:», solo su línea (con su horario y una barra del libre)
  const single = withStaff !== "any";
  const rowsShown = single ? agenda.rows.filter((r) => r.staffId === withStaff) : agenda.rows;

  const cell = (date: string) => {
    const past = date < today;
    const lines = past ? [] : rowsShown.map((row) => ({ row, ...dayOf(row, date) }));
    const nobody = !past && lines.every((l) => l.summary.kind === "off");
    const fit = fits.has(date);
    const isFirst = firstFit?.date === date;
    const dayName = formatDayLong(DateTime.fromISO(date, { zone }).toJSDate(), locale, zone);
    return (
      <Link
        key={date}
        href={dayHref(date)}
        aria-label={`${t("monthDayLabel", { day: dayName })}${fit ? `. ${t("search.fits")}` : ""}`}
        aria-current={date === today ? "date" : undefined}
        className={cn(
          "flex min-h-32 flex-col gap-1.5 border-b border-l p-2 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          past && "bg-muted/30 text-muted-foreground",
          fit && (isFirst ? "ring-2 ring-success ring-inset" : "ring-1 ring-success/70 ring-inset"),
        )}
      >
        <span className="flex items-center justify-between gap-2">
          <span
            className={cn(
              "text-sm font-semibold tabular-nums",
              date === today && "inline-flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground",
            )}
          >
            {Number(date.slice(8))}
          </span>
          {fit && (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                isFirst ? "bg-success text-card" : "bg-success/15 text-success",
              )}
            >
              {isFirst ? t("search.firstBadge") : t("search.fits")}
            </span>
          )}
        </span>
        {nobody ? (
          <span className="text-xs text-muted-foreground">{t("nobodyDay")}</span>
        ) : (
          lines.map(({ row, summary, free, shifts }) => {
            const working = summary.kind === "free" || summary.kind === "full";
            return (
              <span key={row.staffId} className="flex flex-col gap-1">
                {single && working ? (
                  <>
                    {/* Una profesional: su horario arriba, entero; debajo la barra del libre y cuánto queda */}
                    <span className="flex items-start gap-1.5 text-xs">
                      <Dot color={accountColor(row.koiboxAccount)} className="mt-1" />
                      <span className="tabular-nums">{shifts.map((s) => `${time(s.start)}–${time(s.end)}`).join(" · ")}</span>
                    </span>
                    <span className="flex items-center gap-2 text-xs">
                      <span aria-hidden className="relative block h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <span
                          className="absolute inset-y-0 left-0 bg-success"
                          style={{ width: `${Math.round((minutesOf(free) / Math.max(1, minutesOf(shifts))) * 100)}%` }}
                        />
                      </span>
                      <span className={cn("shrink-0 font-medium", summary.kind === "free" ? "text-success" : "text-muted-foreground")}>
                        {summaryText(summary)}
                      </span>
                    </span>
                  </>
                ) : (
                  <span className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Dot color={summary.kind === "off" ? null : accountColor(row.koiboxAccount)} />
                      <span className={cn("truncate", summary.kind === "off" && "text-muted-foreground")}>{row.staffName}</span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 font-medium",
                        summary.kind === "free"
                          ? "text-success"
                          : summary.kind === "absent"
                            ? "text-warning"
                            : "text-muted-foreground",
                      )}
                    >
                      {summaryText(summary)}
                    </span>
                  </span>
                )}
              </span>
            );
          })
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

      {/* ---- «Buscar hueco» ---- */}
      <section aria-label={t("search.title")} className="space-y-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold">{t("search.title")}</h3>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm" aria-live="polite">
              {searchLocation ? searchText : t("search.pickLocation")}
            </span>
            {firstFit && canCreate && (
              <Link
                href={createHref(firstFit)}
                className={cn(navBase, "border-primary bg-primary px-4 text-sm text-primary-foreground hover:bg-primary/90")}
              >
                {t("search.create")}
              </Link>
            )}
          </div>
        </div>
        {searchLocation && (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="me-1 text-sm text-muted-foreground">{t("search.services")}</span>
              {services.map((s) => (
                <Link
                  key={s.id}
                  href={toggleService(s.id)}
                  scroll={false}
                  aria-current={picked.includes(s.id) ? "true" : undefined}
                  className={chip(picked.includes(s.id))}
                >
                  {s.name} · {formatDuration(s.durationMin)}
                </Link>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="me-1 text-sm text-muted-foreground">{t("search.with")}</span>
              <Link
                href={monthHref(month, { with: null })}
                scroll={false}
                aria-current={!single ? "true" : undefined}
                className={chip(!single)}
              >
                {t("search.anyone")}
              </Link>
              {agenda.rows.map((r) => (
                <Link
                  key={r.staffId}
                  href={monthHref(month, { with: String(r.staffId) })}
                  scroll={false}
                  aria-current={withStaff === r.staffId ? "true" : undefined}
                  title={notDoing(r.staffId) ? t("search.notDoing", { staff: r.staffName }) : undefined}
                  className={cn(
                    chip(withStaff === r.staffId),
                    notDoing(r.staffId) && withStaff !== r.staffId && "border-dashed text-muted-foreground",
                  )}
                >
                  {r.koiboxAccount && <Dot color={accountColor(r.koiboxAccount)} />}
                  {r.staffName}
                </Link>
              ))}
            </div>
          </>
        )}
      </section>

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
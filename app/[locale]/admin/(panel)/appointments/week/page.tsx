import { Fragment, Suspense, type ReactNode } from "react";
import { io } from "next/cache";
import { DateTime } from "luxon";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppointmentDetail } from "@/components/admin/appointment-detail";
import { STATUS_TONE } from "@/components/admin/appointment-marks";
import {
  ABSENCE_STRIPES, AGENDA_STATUSES, SEG_TONE, STRIPES, duration, isDay, navBase, positiveId,
} from "@/components/admin/agenda-ui";
import { AppointmentsViewSwitch } from "@/components/admin/appointments-view-switch";
import { AgendaDatePicker } from "@/components/admin/agenda-date-picker";
import { MoveAppointmentForm } from "@/components/admin/move-appointment-form";
import { Dot, SectionLabel, SegmentLinks, StatusPill, textAction } from "@/components/admin/panel-ui";
import { PanelSkeleton } from "@/components/admin/panel-skeleton";
import { Link } from "@/i18n/navigation";
import type { Interval } from "@/lib/availability";
import { loadAgendaWeek, type AgendaWeekRow } from "@/lib/agenda-db";
import { loadAgendaKoibox } from "@/lib/agenda-koibox";
import { daySummary, openGaps, subtractIntervals, weekOf, type DaySummary } from "@/lib/agenda-layout";
import { listAppointments, listFilterOptions, type AppointmentListRow } from "@/lib/appointment-list";
import { chooseCollector } from "@/lib/collectors";
import { latestEmailByAppointment } from "@/lib/email/email-status";
import { formatDayLong, formatShortDate, formatTime } from "@/lib/format";
import { koiboxCardState } from "@/lib/koibox/card-state";
import { writesToKoibox } from "@/lib/koibox-sync";
import { can } from "@/lib/permissions";
import { loadSalonConfig } from "@/lib/salon-config";
import { requireStaff } from "@/lib/session";
import { cn } from "@/lib/utils";

type SearchParams = {
  date?: string; // cualquier día de la semana que se quiere ver; sin él, esta semana
  location?: string;
  all?: string; // "1" = todas las profesionales
  hide?: string; // ids ocultos con «Ver:», separados por comas
  cell?: string; // «Día seleccionado»: "<id de profesional>:<fecha>"
  appt?: string; // la cita abierta dentro de «Día seleccionado»
  col?: string; // en el móvil, la profesional que se ve
};

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
};

export default async function AgendaWeekPage({ params, searchParams }: Props) {
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
        <WeekContent locale={locale} searchParams={searchParams} />
      </Suspense>
    </section>
  );
}

async function WeekContent({ locale, searchParams }: { locale: string; searchParams: Props["searchParams"] }) {
  const { role } = await requireStaff(locale, "appointments.view");
  const sp = await searchParams;
  const [config, t, tCard, tStatus, options] = await Promise.all([
    loadSalonConfig(),
    getTranslations({ locale, namespace: "Admin.agenda" }),
    getTranslations({ locale, namespace: "Admin.card" }),
    getTranslations({ locale, namespace: "Admin.status" }),
    listFilterOptions(),
  ]);

  // "Esta semana" depende de la fecha: fuera del prerenderizado
  await io();
  const now = new Date();
  const nowMs = now.getTime();
  const zone = config.timezone;
  const today = DateTime.fromJSDate(now, { zone }).toISODate()!;
  const week = weekOf(isDay(sp.date) ? sp.date : today);
  const thisWeek = week.from === weekOf(today).from;
  const locationId = options.locations.find((l) => l.id === positiveId(sp.location))?.id;
  const all = sp.all === "1";

  // ---- Citas de la semana y turnos (los mismos que la vista de Día y que la web) ----
  const monday = DateTime.fromISO(week.from, { zone }).startOf("day");
  const appointments = await listAppointments({
    statuses: AGENDA_STATUSES,
    from: monday.toJSDate(),
    to: monday.plus({ days: 7 }).toJSDate(),
    order: "asc",
    locationId,
    limit: 1000,
  });
  const { enabled: koiboxShifts, koibox: koiboxData, down: koiboxDown } = await loadAgendaKoibox(config, week);
  const agenda = await loadAgendaWeek({
    ...week,
    zone,
    locationId,
    all,
    withAppointments: [...new Set(appointments.map((a) => a.staffId))],
    koibox: koiboxData,
  });

  // El domingo solo sale si alguien trabaja o tiene citas ese día
  const localDate = (d: Date) => DateTime.fromJSDate(d, { zone }).toISODate()!;
  const shown = agenda.dates
    .map((date, i) => ({ date, i }))
    .filter(
      ({ date, i }) =>
        i < 6 || agenda.rows.some((r) => r.days[i]?.working) || appointments.some((a) => localDate(a.startsAt) === date),
    );

  // ---- «Ver:»: profesionales ocultas ----
  const hidden = new Set((sp.hide ?? "").split(",").map((v) => positiveId(v)).filter((v): v is number => v !== undefined));
  const visible = agenda.rows.filter((r) => !hidden.has(r.staffId));

  // ---- Casilla elegida y cita abierta ----
  const [cellStaff, cellDate] = (sp.cell ?? "").split(":");
  const selectedRow = visible.find((r) => r.staffId === positiveId(cellStaff));
  const selectedIndex = selectedRow ? agenda.dates.indexOf(cellDate ?? "") : -1;
  const hasCell = selectedRow !== undefined && selectedIndex >= 0;
  const focusId =
    visible.find((r) => r.staffId === positiveId(sp.col))?.staffId ?? selectedRow?.staffId ?? visible[0]?.staffId;

  // ---- Enlaces: se conserva la semana, el local, «Todas», lo oculto y la casilla ----
  const current = {
    date: thisWeek ? null : week.from,
    location: locationId ? String(locationId) : null,
    all: all ? "1" : null,
    hide: hidden.size > 0 ? [...hidden].join(",") : null,
    cell: hasCell ? `${selectedRow.staffId}:${cellDate}` : null,
    appt: null as string | null,
    col: sp.col && focusId ? String(focusId) : null,
  };
  const href = (changes: Partial<typeof current>) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...current, ...changes })) if (value) q.set(key, value);
    const qs = q.toString();
    return `/admin/appointments/week${qs ? `?${qs}` : ""}`;
  };
  const weekHref = (from: DateTime) => {
    const iso = from.toISODate()!;
    return href({ date: iso === weekOf(today).from ? null : iso, cell: null, appt: null });
  };
  const dayHref = (date: string) => {
    const q = new URLSearchParams();
    if (date !== today) q.set("date", date);
    if (locationId) q.set("location", String(locationId));
    if (all) q.set("all", "1");
    const qs = q.toString();
    return `/admin/appointments${qs ? `?${qs}` : ""}`;
  };
  // «Nueva cita» se abre en el Día: vacía, o en un hueco libre de una profesional
  const canCreate = can(role, "appointments.manage");
  const newHref = (date: string, staffId?: number, at?: Date) => {
    const q = new URLSearchParams();
    if (date !== today) q.set("date", date);
    if (locationId) q.set("location", String(locationId));
    if (all) q.set("all", "1");
    q.set("new", staffId && at ? `${staffId}@${DateTime.fromJSDate(at, { zone }).toFormat("HH:mm")}` : "1");
    if (staffId) q.set("col", String(staffId));
    return `/admin/appointments?${q}`;
  };
  const toggleHidden = (id: number) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return href({ hide: next.size > 0 ? [...next].join(",") : null, cell: null, appt: null });
  };

  // ---- Medidas de la barra: de la primera entrada a la última salida de la semana ----
  const localMin = (d: Date) => {
    const x = DateTime.fromJSDate(d, { zone });
    return x.hour * 60 + x.minute;
  };
  const allShifts = agenda.rows.flatMap((r) => r.days.flatMap((d) => d?.shifts ?? []));
  const from = allShifts.length ? Math.floor(Math.min(...allShifts.map((s) => localMin(s.start))) / 60) * 60 : 540;
  const to = allShifts.length ? Math.ceil(Math.max(...allShifts.map((s) => localMin(s.end))) / 60) * 60 : 1200;
  const seg = (iv: Interval) => {
    const s = Math.max(from, localMin(iv.start));
    const e = Math.min(to, localMin(iv.end) || 1440); // las 00:00 del día siguiente = fin del día
    return { left: `${((s - from) / (to - from)) * 100}%`, width: `${(Math.max(0, e - s) / (to - from)) * 100}%` };
  };

  const time = (d: Date) => formatTime(d, locale, zone);
  const range = (iv: Interval) => `${time(iv.start)}–${time(iv.end)}`;
  const dayLabel = (date: string) => DateTime.fromISO(date, { zone }).setLocale(locale).toFormat("cccc d");
  const accountColor = (account: string | null) =>
    account ? chooseCollector(config, { koiboxAccount: account }).collector.color : null;
  const accountLabel = (account: string | null) =>
    account ? (config.koibox.accounts[account]?.label ?? account) : null;
  // Cuentas de Koibox para el diálogo «¿Mover la cita?»
  const moveAccounts = Object.fromEntries(
    Object.keys(config.koibox.accounts).map((a) => [a, { label: accountLabel(a)! }]),
  );
  const severalLocations = options.locations.length > 1;

  // ---- Lo de cada casilla: citas, ocupado en Koibox, huecos libres y resumen ----
  const byCell = new Map<string, AppointmentListRow[]>();
  for (const a of appointments) {
    const key = `${a.staffId}|${localDate(a.startsAt)}`;
    byCell.set(key, [...(byCell.get(key) ?? []), a]);
  }
  const cellOf = (row: AgendaWeekRow, i: number) => {
    const day = row.days[i];
    const date = agenda.dates[i];
    const appts = byCell.get(`${row.staffId}|${date}`) ?? [];
    const ours = appts.map((a) => ({ start: a.startsAt, end: a.endsAt }));
    // Citas que solo están en Koibox (creadas allí): ocupan, aunque no las tengamos
    const koiboxOnly = day ? subtractIntervals(day.koiboxBusy, ours) : [];
    const result: { summary: DaySummary; free: Interval[] } = day
      ? daySummary(day, [...ours, ...koiboxOnly])
      : { summary: { kind: "off" }, free: [] };
    return { day, date, appts, koiboxOnly, ...result };
  };
  const summaryText = (s: DaySummary) =>
    s.kind === "off"
      ? t("offDay")
      : s.kind === "absent"
        ? t("absent")
        : s.kind === "full"
          ? t("full")
          : t("freeSummary", { time: duration(s.minutes), many: s.minutes >= 120 ? "yes" : "no" });
  const shiftText = (day: AgendaWeekRow["days"][number]) =>
    day?.working ? day.shifts.map((s) => range(s)).join(" · ") : t("offDay");

  const cellLink = (row: AgendaWeekRow, i: number, withDay = false): ReactNode => {
    const c = cellOf(row, i);
    const isSelected = hasCell && selectedRow.staffId === row.staffId && selectedIndex === i;
    return (
      <Link
        href={href({ cell: isSelected ? null : `${row.staffId}:${c.date}`, appt: null })}
        scroll={false}
        aria-current={isSelected ? "true" : undefined}
        aria-label={t("cellLabel", {
          name: row.staffName,
          day: formatDayLong(DateTime.fromISO(c.date, { zone }).toJSDate(), locale, zone),
          shift: shiftText(c.day),
          summary: c.summary.kind === "off" ? "" : summaryText(c.summary),
        })}
        className={cn(
          "flex h-full min-h-20 w-full flex-col gap-1.5 rounded-md p-2 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring",
          isSelected && "bg-muted ring-2 ring-foreground",
        )}
      >
        {withDay && <span className="text-sm font-semibold first-letter:uppercase">{dayLabel(c.date)}</span>}
        <span className="text-xs text-muted-foreground">{shiftText(c.day)}</span>
        <span aria-hidden className="relative block h-3.5 overflow-hidden rounded" style={{ backgroundImage: STRIPES }}>
          {c.day?.shifts.map((s) => (
            <span key={`s${s.start.getTime()}`} className="absolute inset-y-0 bg-card" style={seg(s)} />
          ))}
          {c.free.map((f) => (
            <span
              key={`f${f.start.getTime()}`}
              className="absolute inset-y-0 border border-dashed border-muted-foreground/50 bg-card"
              style={seg(f)}
            />
          ))}
          {c.appts.map((a) => (
            <span
              key={`a${a.id}`}
              className={cn("absolute inset-y-0 border-r border-card", SEG_TONE[a.status])}
              style={seg({ start: a.startsAt, end: a.endsAt })}
            />
          ))}
          {c.koiboxOnly.map((k) => (
            <span key={`k${k.start.getTime()}`} className="absolute inset-y-0 bg-foreground/25" style={seg(k)} />
          ))}
          {[...(c.day?.timeOff ?? []), ...(c.day?.blocks ?? [])].map((x) => (
            <span
              key={`x${x.start.getTime()}`}
              className="absolute inset-y-0"
              style={{ ...seg(x), backgroundImage: ABSENCE_STRIPES }}
            />
          ))}
        </span>
        <span
          className={cn(
            "text-xs font-medium",
            c.summary.kind === "free" ? "text-foreground" : c.summary.kind === "absent" ? "text-warning" : "text-muted-foreground",
          )}
        >
          {c.summary.kind === "off" ? "" : summaryText(c.summary)}
        </span>
      </Link>
    );
  };

  const nameCell = (row: AgendaWeekRow) => (
    <>
      <p className="flex items-center gap-2 font-semibold">
        {row.koiboxAccount && <Dot color={accountColor(row.koiboxAccount)} />}
        {row.staffName}
      </p>
      <p className="text-xs text-muted-foreground">{accountLabel(row.koiboxAccount)}</p>
      {row.unlinked && <p className="text-xs font-medium text-warning">{t("unlinked")}</p>}
    </>
  );

  // ---- «Día seleccionado» ----
  let panel: ReactNode = null;
  if (hasCell) {
    const c = cellOf(selectedRow, selectedIndex);
    const openRow = c.appts.find((a) => a.id === positiveId(sp.appt));
    const koibox = writesToKoibox(config);
    const email = openRow ? ((await latestEmailByAppointment([openRow.id])).get(openRow.id) ?? null) : null;
    const open = openRow && {
      ...openRow,
      email,
      koibox: koibox ? koiboxCardState(openRow, now) : null,
      koiboxAccountLabel: accountLabel(openRow.koiboxAccount),
    };
    const items = [
      ...c.appts.map((a) => ({ key: `a${a.id}`, at: a.startsAt.getTime(), node: (
        <Link
          href={href({ appt: String(a.id) })}
          scroll={false}
          className="flex items-start justify-between gap-3 rounded-lg border bg-background p-3 outline-none hover:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="min-w-0">
            <span className="block text-xs text-muted-foreground tabular-nums">{range({ start: a.startsAt, end: a.endsAt })}</span>
            <span className="block truncate text-sm font-medium">{a.clientName}</span>
            <span className="block truncate text-xs text-muted-foreground">{a.serviceName}</span>
          </span>
          <StatusPill tone={STATUS_TONE[a.status]}>{tStatus(a.status)}</StatusPill>
        </Link>
      ) })),
      ...c.koiboxOnly.map((k) => ({ key: `k${k.start.getTime()}`, at: k.start.getTime(), node: (
        <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          <span className="block text-xs tabular-nums">{range(k)}</span>
          {t("koiboxBusy")}
        </div>
      ) })),
      ...c.free.map((f) => {
        // Lo que aún no ha pasado se puede pulsar: abre «Nueva cita» en el Día, en ese hueco
        const open = canCreate ? openGaps([f], now)[0] : undefined;
        const body = (
          <>
            <span className="block text-xs tabular-nums">{range(f)}</span>
            <span className="font-medium">{t("freeSlot")}</span>
            <span className="text-muted-foreground"> · {duration((f.end.getTime() - f.start.getTime()) / 60_000)}</span>
          </>
        );
        return {
          key: `f${f.start.getTime()}`,
          at: f.start.getTime(),
          node: open ? (
            <Link
              href={newHref(c.date, selectedRow.staffId, open.start)}
              aria-label={t("newAppointment.gapLabel", {
                time: range(open),
                duration: duration((open.end.getTime() - open.start.getTime()) / 60_000),
              })}
              className="block rounded-lg border border-dashed border-muted-foreground/40 p-3 text-sm outline-none hover:border-foreground/50 hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
            >
              {body}
            </Link>
          ) : (
            <div className="rounded-lg border border-dashed border-muted-foreground/40 p-3 text-sm">{body}</div>
          ),
        };
      }),
      ...[...(c.day?.timeOff ?? []), ...(c.day?.blocks ?? [])].map((x) => ({ key: `x${x.start.getTime()}`, at: x.start.getTime(), node: (
        <div className="rounded-lg p-3 text-sm text-muted-foreground" style={{ backgroundImage: ABSENCE_STRIPES }}>
          <span className="block text-xs tabular-nums">{range(x)}</span>
          {t("absent")}
        </div>
      ) })),
    ].sort((a, b) => a.at - b.at);

    panel = (
      <aside
        aria-label={t("selectedDay")}
        className="space-y-3 rounded-xl border bg-card p-4 max-md:fixed max-md:inset-0 max-md:z-50 max-md:overflow-y-auto max-md:rounded-none max-md:border-0 xl:sticky xl:top-4 xl:w-[24rem] xl:shrink-0"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <SectionLabel>{t("selectedDay")}</SectionLabel>
            {nameCell(selectedRow)}
            <p className="text-sm first-letter:uppercase">
              {formatDayLong(DateTime.fromISO(c.date, { zone }).toJSDate(), locale, zone)} · {shiftText(c.day)}
            </p>
          </div>
          <Link
            href={href({ cell: null, appt: null })}
            scroll={false}
            aria-label={t("panel.close")}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </Link>
        </div>

        {open ? (
          <div className="space-y-3 border-t pt-3">
            <Link href={href({ appt: null })} scroll={false} className={textAction()}>
              ← {t("backToDay")}
            </Link>
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">{tCard("reference", { id: open.id })}</p>
              <h2 className="text-lg font-semibold">
                {range({ start: open.startsAt, end: open.endsAt })} · {open.serviceName}
              </h2>
              <StatusPill tone={STATUS_TONE[open.status]}>{tStatus(open.status)}</StatusPill>
            </div>
            <div className="space-y-0.5 text-sm">
              <p className="font-medium">{open.clientName}</p>
              <p className="text-muted-foreground">
                {open.clientPhone}
                {open.clientEmail ? ` · ${open.clientEmail}` : ""}
              </p>
              <Link href={`/admin/appointments/list?client=${open.clientId}`} className={cn(textAction(), "min-h-9")}>
                {tCard("allClientAppointments")}
              </Link>
            </div>
            <AppointmentDetail
              data={open}
              locale={locale}
              zone={zone}
              currency={config.currency}
              salonName={config.name}
              phoneCountryCode={config.phoneCountryCode}
              now={nowMs}
              actionable={open.status === "pending_deposit" || open.startsAt.getTime() > nowMs}
              canValidate={can(role, "deposits.manage")}
              canCancel={can(role, "appointments.manage")}
              canResend={can(role, "appointments.manage")}
              canRetryKoibox={can(role, "appointments.manage")}
              layout="stack"
            />
            {canCreate &&
              (open.status === "booked" || open.status === "pending_deposit") &&
              open.startsAt.getTime() > nowMs && (
                <div className="border-t pt-3">
                  <MoveAppointmentForm
                    key={`${open.id}|${open.staffId}|${open.startsAt.getTime()}|${open.endsAt.getTime()}`}
                    appointment={{
                      id: open.id,
                      staffId: open.staffId,
                      start: open.startsAt.toISOString(),
                      end: open.endsAt.toISOString(),
                      client: open.clientName,
                      service: open.serviceName,
                      hasEmail: open.hasEmail,
                    }}
                    staff={options.staff.map((s) => ({ ...s, account: null }))}
                    accounts={moveAccounts}
                    locale={locale}
                    zone={zone}
                  />
                </div>
              )}
          </div>
        ) : (
          <div className="space-y-2 border-t pt-3">
            {items.length > 0 ? (
              <ul className="space-y-2">
                {items.map((it) => (
                  <li key={it.key}>{it.node}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("offDay")}</p>
            )}
            <Link href={dayHref(c.date)} className={textAction()}>
              {t("openDay")} →
            </Link>
          </div>
        )}
      </aside>
    );
  }

  const weekTitle = t("weekTitle", {
    from: formatShortDate(monday.toJSDate(), locale, zone, now),
    to: formatShortDate(monday.plus({ days: 6 }).toJSDate(), locale, zone, now),
  });

  return (
    <div className="space-y-4">
      {/* ---- Barra: semana, vista, local y quién sale ---- */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Link href={weekHref(monday.minus({ days: 7 }))} aria-label={t("previousWeek")} className={cn(navBase, "w-11 text-lg")}>
            ‹
          </Link>
          <Link
            href={weekHref(DateTime.fromISO(weekOf(today).from, { zone }))}
            aria-current={thisWeek ? "date" : undefined}
            className={cn(navBase, "px-3.5 text-sm")}
          >
            {t("thisWeek")}
          </Link>
          <Link href={weekHref(monday.plus({ days: 7 }))} aria-label={t("nextWeek")} className={cn(navBase, "w-11 text-lg")}>
            ›
          </Link>
        </div>
        <h2>
          <AgendaDatePicker
            label={weekTitle}
            value={hasCell ? cellDate! : week.from}
            today={today}
            locale={locale}
            mode="week"
            basePath="/admin/appointments/week"
            keep={Object.fromEntries(
              Object.entries({ location: current.location, all: current.all, hide: current.hide }).filter(
                (e): e is [string, string] => e[1] !== null,
              ),
            )}
            labels={{
              open: t("picker.open"),
              previous: t("picker.previous"),
              next: t("picker.next"),
              today: t("thisWeek"),
              hint: t("picker.hintWeek"),
            }}
          />
        </h2>
        {canCreate && (
          <Link href={newHref(hasCell ? cellDate! : thisWeek ? today : week.from)} className={cn(navBase, "px-3.5 text-sm")}>
            {t("newAppointment.open")}
          </Link>
        )}
        <div className="flex min-w-0 max-w-full flex-wrap gap-3 lg:ms-auto">
          <SegmentLinks
            label={t("viewLabel")}
            items={[
              { href: dayHref(hasCell ? cellDate! : thisWeek ? today : week.from), label: t("day"), active: false },
              { href: href({}), label: t("week"), active: true },
            ]}
          />
          {severalLocations && (
            <SegmentLinks
              label={t("locationsLabel")}
              items={[
                { href: href({ location: null, cell: null }), label: t("allLocations"), active: !locationId },
                ...options.locations.map((l) => ({
                  href: href({ location: String(l.id), cell: null }),
                  label: l.name,
                  active: l.id === locationId,
                })),
              ]}
            />
          )}
          <SegmentLinks
            label={t("staffLabel")}
            items={[
              { href: href({ all: null, cell: null }), label: t("working"), active: !all },
              { href: href({ all: "1", cell: null }), label: t("all"), active: all },
            ]}
          />
        </div>
      </div>

      {/* ---- «Ver:» y leyenda ---- */}
      {agenda.rows.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{t("show")}</span>
          {agenda.rows.map((r) => {
            const off = hidden.has(r.staffId);
            return (
              <Link
                key={r.staffId}
                href={toggleHidden(r.staffId)}
                scroll={false}
                aria-label={off ? t("showStaff", { name: r.staffName }) : t("hideStaff", { name: r.staffName })}
                className={cn(
                  "inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  off ? "border-dashed text-muted-foreground line-through" : "bg-card font-medium",
                )}
              >
                {r.koiboxAccount && <Dot color={accountColor(r.koiboxAccount)} />}
                {r.staffName}
              </Link>
            );
          })}
        </div>
      )}
      <ul aria-label={t("legend.label")} className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className={cn("h-3 w-5 rounded-sm", SEG_TONE.booked)} />
          {t("legend.booked")}
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className={cn("h-3 w-5 rounded-sm", SEG_TONE.pending_deposit)} />
          {t("legend.pending")}
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-5 rounded-sm border border-dashed border-muted-foreground/50 bg-card" />
          {t("legend.free")}
        </li>
        {koiboxShifts && (
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-3 w-5 rounded-sm bg-foreground/25" />
            {t("legend.koiboxBusy")}
          </li>
        )}
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-5 rounded-sm" style={{ backgroundImage: ABSENCE_STRIPES }} />
          {t("legend.timeOff")}
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-5 rounded-sm border" style={{ backgroundImage: STRIPES }} />
          {t("legend.offHours")}
        </li>
        {koiboxShifts && <li>{t("koiboxSource")}</li>}
      </ul>
      {koiboxDown && (
        <p role="status" className="rounded-xl border-l-4 border-warning bg-warning/15 px-4 py-3 text-sm">
          {t("koiboxDown")}
        </p>
      )}

      {visible.length === 0 ? (
        <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
          {t("nobodyWeek")}{" "}
          {!all && (
            <Link href={href({ all: "1" })} className="font-medium text-foreground underline-offset-4 hover:underline">
              {t("showAll")}
            </Link>
          )}
        </p>
      ) : (
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
          <div className="min-w-0 flex-1 space-y-3">
            {/* ---- Escritorio: filas por profesional, columnas por día ---- */}
            <div
              role="region"
              aria-label={t("weekGridLabel", { week: weekTitle })}
              tabIndex={0}
              className="hidden overflow-x-auto rounded-xl border bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring md:block"
            >
              <div
                className="grid min-w-fit"
                style={{ gridTemplateColumns: `11rem repeat(${shown.length}, minmax(8.5rem, 1fr))` }}
              >
                <div className="sticky left-0 z-10 border-b bg-card px-3 py-2.5 text-xs font-medium tracking-[0.06em] text-muted-foreground uppercase">
                  {t("professional")}
                </div>
                {shown.map(({ date }) => (
                  <div key={date} className="border-b border-l px-3 py-2.5">
                    <Link
                      href={dayHref(date)}
                      aria-current={date === today ? "date" : undefined}
                      className={cn(
                        "text-sm font-semibold underline-offset-4 first-letter:uppercase hover:underline",
                        date === today && "text-success",
                      )}
                    >
                      {dayLabel(date)}
                    </Link>
                  </div>
                ))}
                {visible.map((row) => (
                  <Fragment key={row.staffId}>
                    <div className="sticky left-0 z-10 border-b bg-card px-3 py-3">{nameCell(row)}</div>
                    {shown.map(({ date, i }) => (
                      <div key={date} className="border-b border-l p-1.5">
                        {cellLink(row, i)}
                      </div>
                    ))}
                  </Fragment>
                ))}
              </div>
            </div>

            {/* ---- Móvil: una profesional cada vez, sus días uno debajo de otro ---- */}
            <div className="space-y-3 md:hidden">
              {visible.length > 1 && (
                <SegmentLinks
                  label={t("staffTabs")}
                  items={visible.map((r) => ({
                    href: href({ col: String(r.staffId), cell: null }),
                    label: r.staffName,
                    active: r.staffId === focusId,
                  }))}
                />
              )}
              {visible
                .filter((r) => r.staffId === focusId)
                .map((row) => (
                  <div key={row.staffId} className="space-y-2 rounded-xl border bg-card p-3">
                    {nameCell(row)}
                    <ul className="divide-y">
                      {shown.map(({ date, i }) => (
                        <li key={date} className="py-1">
                          {cellLink(row, i, true)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          </div>
          {panel}
        </div>
      )}
    </div>
  );
}
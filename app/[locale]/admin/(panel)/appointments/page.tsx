import { Suspense } from "react";
import type React from "react";
import { io } from "next/cache";
import { DateTime } from "luxon";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppointmentDetail } from "@/components/admin/appointment-detail";
import { KOIBOX_TONE, STATUS_TONE } from "@/components/admin/appointment-marks";
import { AppointmentsViewSwitch } from "@/components/admin/appointments-view-switch";
import { SegmentLinks, StatusPill, textAction } from "@/components/admin/panel-ui";
import { PanelSkeleton } from "@/components/admin/panel-skeleton";
import { Link } from "@/i18n/navigation";
import type { Interval } from "@/lib/availability";
import { loadAgendaColumns } from "@/lib/agenda-db";
import { agendaWindow, placeInColumn, weekOf } from "@/lib/agenda-layout";
import { listAppointments, listFilterOptions } from "@/lib/appointment-list";
import { latestEmailByAppointment } from "@/lib/email/email-status";
import { formatDayLong, formatTime } from "@/lib/format";
import { koiboxCardState } from "@/lib/koibox/card-state";
import { writesToKoibox } from "@/lib/koibox-sync";
import { AGENDA_STATUSES, BLOCK_STYLE, BLOCK_TONE, STRIPES, isDay, navBase, positiveId } from "@/components/admin/agenda-ui";
import { loadAgendaKoibox } from "@/lib/agenda-koibox";
import { can } from "@/lib/permissions";
import { loadSalonConfig } from "@/lib/salon-config";
import { requireStaff } from "@/lib/session";
import { cn } from "@/lib/utils";

type SearchParams = {
  date?: string; // "2026-11-16"; sin él, hoy
  location?: string;
  all?: string; // "1" = todas las profesionales, también las que no trabajan ese día
  appt?: string; // la cita abierta en la ficha
  col?: string; // en el móvil, la profesional que se ve (una columna cada vez)
};

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
};

const MIN = 60_000;
// Una línea por hora (1 minuto = 1 px, así que una hora = 60 px)
const HOUR_LINES = "repeating-linear-gradient(to bottom, var(--border) 0 1px, transparent 1px 60px)";

export default async function AgendaPage({ params, searchParams }: Props) {
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
        <AgendaContent locale={locale} searchParams={searchParams} />
      </Suspense>
    </section>
  );
}

async function AgendaContent({ locale, searchParams }: { locale: string; searchParams: Props["searchParams"] }) {
  const { role } = await requireStaff(locale, "appointments.view");
  const sp = await searchParams;
  const [config, t, tCard, tStatus, options] = await Promise.all([
    loadSalonConfig(),
    getTranslations({ locale, namespace: "Admin.agenda" }),
    getTranslations({ locale, namespace: "Admin.card" }),
    getTranslations({ locale, namespace: "Admin.status" }),
    listFilterOptions(),
  ]);

  // "Hoy" y la línea de "ahora" dependen de la hora: fuera del prerenderizado
  await io();
  const now = new Date();
  const nowMs = now.getTime();
  const zone = config.timezone;
  const today = DateTime.fromJSDate(now, { zone }).toISODate()!;
  const date = isDay(sp.date) ? sp.date : today;
  const isToday = date === today;
  const day = DateTime.fromISO(date, { zone }).startOf("day");
  const dayStart = day.toJSDate();
  // Solo un local que exista; si no, todos
  const locationId = options.locations.find((l) => l.id === positiveId(sp.location))?.id;
  const all = sp.all === "1";

  const rows = await listAppointments({
    statuses: AGENDA_STATUSES,
    from: dayStart,
    to: day.plus({ days: 1 }).toJSDate(),
    order: "asc",
    locationId,
    limit: 500,
  });

  // Modo Koibox: turnos de Koibox (igual que la web), con la foto de la semana en caché
  const { enabled: koiboxShifts, koibox: koiboxData, down: koiboxDown } = await loadAgendaKoibox(config, weekOf(date));

  const columns = await loadAgendaColumns({
    date,
    zone,
    locationId,
    all,
    withAppointments: [...new Set(rows.map((r) => r.staffId))],
    koibox: koiboxData,
  });

  // En el móvil se ve una columna cada vez: la elegida, la de la cita abierta o la primera
  const focusId =
    columns.find((c) => c.staffId === positiveId(sp.col))?.staffId ??
    (columns.some((c) => c.staffId === rows.find((r) => r.id === positiveId(sp.appt))?.staffId)
      ? rows.find((r) => r.id === positiveId(sp.appt))!.staffId
      : columns[0]?.staffId);

  // ---- La cita abierta en la ficha: los mismos datos que en la Lista ----
  const koibox = writesToKoibox(config);
  const selectedRow = rows.find((r) => r.id === positiveId(sp.appt));
  const email = selectedRow
    ? ((await latestEmailByAppointment([selectedRow.id])).get(selectedRow.id) ?? null)
    : null;
  const selected = selectedRow && {
    ...selectedRow,
    email,
    koibox: koibox ? koiboxCardState(selectedRow, now) : null,
    koiboxAccountLabel: selectedRow.koiboxAccount
      ? (config.koibox.accounts[selectedRow.koiboxAccount]?.label ?? selectedRow.koiboxAccount)
      : null,
  };

  // ---- Medidas: 1 minuto = 1 px desde el inicio de la ventana ----
  const view = agendaWindow(
    [...columns.flatMap((c) => c.shifts), ...rows.map((r) => ({ start: r.startsAt, end: r.endsAt }))],
    dayStart,
  );
  const heightPx = (view.end.getTime() - view.start.getTime()) / MIN;
  const offset = (d: Date) => (d.getTime() - view.start.getTime()) / MIN;
  const box = (iv: Interval) => {
    const top = Math.max(0, offset(iv.start));
    return { top, height: Math.max(0, Math.min(heightPx, offset(iv.end)) - top) };
  };
  const nowTop = isToday && nowMs >= view.start.getTime() && nowMs < view.end.getTime() ? offset(now) : null;

  // ---- Enlaces: se conserva el día, el local, «Todas» y la cita abierta, salvo lo que cambie ----
  const current = {
    date: isToday ? null : date,
    location: locationId ? String(locationId) : null,
    all: all ? "1" : null,
    col: focusId && sp.col ? String(focusId) : null,
    appt: selectedRow ? String(selectedRow.id) : null,
  };
  const href = (changes: Partial<typeof current>) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...current, ...changes })) if (value) q.set(key, value);
    const qs = q.toString();
    return `/admin/appointments${qs ? `?${qs}` : ""}`;
  };
  const dayHref = (d: DateTime) => {
    const iso = d.toISODate()!;
    return href({ date: iso === today ? null : iso, appt: null });
  };
  const weekHref = (() => {
    const q = new URLSearchParams();
    if (!isToday) q.set("date", date);
    if (locationId) q.set("location", String(locationId));
    if (all) q.set("all", "1");
    const qs = q.toString();
    return `/admin/appointments/week${qs ? `?${qs}` : ""}`;
  })();

  const time = (d: Date) => formatTime(d, locale, zone);
  const range = (iv: Interval) => `${time(iv.start)}–${time(iv.end)}`;
  const dayTitle = formatDayLong(dayStart, locale, zone);
  const severalLocations = options.locations.length > 1;

  return (
    <div className="space-y-4">
      {/* ---- Barra: día, local y quién sale ---- */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Link href={dayHref(day.minus({ days: 1 }))} aria-label={t("previous")} className={cn(navBase, "w-11 text-lg")}>
            ‹
          </Link>
          <Link
            href={dayHref(DateTime.fromISO(today, { zone }))}
            aria-current={isToday ? "date" : undefined}
            className={cn(navBase, "px-3.5 text-sm")}
          >
            {t("today")}
          </Link>
          <Link href={dayHref(day.plus({ days: 1 }))} aria-label={t("next")} className={cn(navBase, "w-11 text-lg")}>
            ›
          </Link>
        </div>
        <h2 className="text-lg font-semibold first-letter:uppercase">
          {isToday ? t("todayTitle", { date: dayTitle }) : dayTitle}
        </h2>
        <div className="flex min-w-0 max-w-full flex-wrap gap-3 lg:ms-auto">
          <SegmentLinks
            label={t("viewLabel")}
            items={[
              { href: href({ appt: null }), label: t("day"), active: true },
              { href: weekHref, label: t("week"), active: false },
            ]}
          />
          {severalLocations && (
            <SegmentLinks
              label={t("locationsLabel")}
              items={[
                { href: href({ location: null, appt: null }), label: t("allLocations"), active: !locationId },
                ...options.locations.map((l) => ({
                  href: href({ location: String(l.id), appt: null }),
                  label: l.name,
                  active: l.id === locationId,
                })),
              ]}
            />
          )}
          <SegmentLinks
            label={t("staffLabel")}
            items={[
              { href: href({ all: null }), label: t("working"), active: !all },
              { href: href({ all: "1" }), label: t("all"), active: all },
            ]}
          />
        </div>
      </div>

      {/* ---- Leyenda: las mismas marcas que en la Lista ---- */}
      <ul aria-label={t("legend.label")} className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className={cn("size-3 rounded-sm border", BLOCK_TONE.booked)} />
          {t("legend.booked")}
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className={cn("size-3 rounded-sm border", BLOCK_TONE.pending_deposit)} />
          {t("legend.pending")}
        </li>
        {koibox && (
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-full bg-danger" />
            {t("legend.koibox")}
          </li>
        )}
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-3 rounded-sm border" style={{ backgroundImage: STRIPES }} />
          {t("legend.timeOff")}
        </li>
        {koiboxShifts && (
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cn("size-3 rounded-sm border", BLOCK_STYLE)} />
            {t("legend.koiboxBlock")}
          </li>
        )}
        {koiboxShifts && <li>{t("koiboxSource")}</li>}
      </ul>

      {koiboxDown && (
        <p role="status" className="rounded-xl border-l-4 border-warning bg-warning/15 px-4 py-3 text-sm">
          {t("koiboxDown")}
        </p>
      )}

      {columns.length > 1 && (
        <SegmentLinks
          className="md:hidden"
          label={t("staffTabs")}
          items={columns.map((c) => ({
            href: href({ col: String(c.staffId), appt: null }),
            label: c.staffName,
            active: c.staffId === focusId,
          }))}
        />
      )}

      {columns.length === 0 ? (
        <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
          {t("nobody")}{" "}
          {!all && (
            <Link href={href({ all: "1" })} className="font-medium text-foreground underline-offset-4 hover:underline">
              {t("showAll")}
            </Link>
          )}
        </p>
      ) : (
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
          {/* ---- Rejilla: una columna por profesional ---- */}
          <div
            role="region"
            aria-label={t("gridLabel", { date: dayTitle })}
            tabIndex={0}
            className="min-w-0 flex-1 overflow-x-auto rounded-xl border bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div
              className="grid grid-cols-[3.5rem_1fr] md:min-w-fit md:[grid-template-columns:3.5rem_repeat(var(--cols),minmax(10rem,1fr))]"
              style={{ "--cols": columns.length } as React.CSSProperties}
            >
              <div className="sticky left-0 z-20 border-b bg-card" />
              {columns.map((c) => (
                <div
                  key={c.staffId}
                  className={cn("min-w-0 border-b border-l px-3 py-2.5", c.staffId !== focusId && "max-md:hidden")}
                >
                  <p className="truncate text-sm font-semibold">{c.staffName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {c.working
                      ? c.shifts
                          .map(
                            (s) =>
                              range(s) + (severalLocations && !locationId && s.locationName ? ` · ${s.locationName}` : ""),
                          )
                          .join(" · ")
                      : t("notWorking")}
                  </p>
                  {c.unlinked && <p className="truncate text-xs font-medium text-warning">{t("unlinked")}</p>}
                </div>
              ))}

              {/* Horas, fijas a la izquierda al desplazar de lado */}
              <div className="sticky left-0 z-20 bg-card" style={{ height: heightPx }}>
                {view.hours.map((h, i) => (
                  <span
                    key={h.getTime()}
                    className={cn(
                      "absolute right-2 text-xs text-muted-foreground tabular-nums",
                      i > 0 && "-translate-y-1/2",
                    )}
                    style={{ top: offset(h) + (i === 0 ? 4 : 0) }}
                  >
                    {time(h)}
                  </span>
                ))}
              </div>

              {columns.map((c) => {
                const mine = rows
                  .filter((r) => r.staffId === c.staffId)
                  .map((r) => ({ ...r, start: r.startsAt, end: r.endsAt }));
                return (
                  <div
                    key={c.staffId}
                    className={cn("relative border-l bg-muted", c.staffId !== focusId && "max-md:hidden")}
                    style={{ height: heightPx }}
                  >
                    {/* Fuera de turno queda en gris; el turno, en blanco */}
                    {c.shifts.map((s) => (
                      <div key={s.start.getTime()} aria-hidden className="absolute inset-x-0 bg-card" style={box(s)} />
                    ))}
                    {c.timeOff.map((a) => (
                      <div
                        key={a.start.getTime()}
                        className="absolute inset-x-0 px-2 pt-1 text-xs text-muted-foreground"
                        style={{ ...box(a), backgroundImage: STRIPES }}
                      >
                        {t("timeOff")}
                      </div>
                    ))}
                    {c.blocks.map((b) => (
                      <div
                        key={`b${b.start.getTime()}`}
                        className={cn("absolute inset-x-0 px-2 pt-1 text-xs text-muted-foreground", BLOCK_STYLE)}
                        style={box(b)}
                      >
                        {t("koiboxBlock")}
                      </div>
                    ))}
                    <div aria-hidden className="pointer-events-none absolute inset-0" style={{ backgroundImage: HOUR_LINES }} />
                    {nowTop !== null && (
                      <div
                        aria-hidden
                        className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-danger"
                        style={{ top: nowTop }}
                      />
                    )}

                    {placeInColumn(mine, view).map(({ item: r, top, height, lane, lanes }) => {
                      const k = koibox ? koiboxCardState(r, now) : null;
                      const isSelected = r.id === selectedRow?.id;
                      return (
                        <Link
                          key={r.id}
                          href={href({ appt: isSelected ? null : String(r.id) })}
                          scroll={false}
                          aria-current={isSelected ? "true" : undefined}
                          aria-label={t("block", {
                            time: range(r),
                            client: r.clientName,
                            service: r.serviceName,
                            status: tStatus(r.status),
                          })}
                          className={cn(
                            "absolute z-10 flex flex-col overflow-hidden rounded-md border px-2 py-1 text-left outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring",
                            BLOCK_TONE[r.status],
                            isSelected && "ring-2 ring-foreground",
                          )}
                          style={{
                            top,
                            height,
                            left: `calc(${(lane * 100) / lanes}% + 3px)`,
                            width: `calc(${100 / lanes}% - 6px)`,
                          }}
                        >
                          <span className="flex items-center gap-1.5 text-xs font-medium tabular-nums">
                            {time(r.startsAt)}
                            {k && k.kind !== "synced" && (
                              <span aria-hidden className={cn("size-2 shrink-0 rounded-full", KOIBOX_TONE[k.kind].dot)} />
                            )}
                          </span>
                          <span className="truncate text-sm font-medium">{r.clientName}</span>
                          {height >= 45 && <span className="truncate text-xs text-muted-foreground">{r.serviceName}</span>}
                        </Link>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ---- Ficha de la cita: la MISMA que se despliega en la Lista ---- */}
          {selected && (
            <aside
              aria-label={t("panel.label")}
              className="space-y-3 rounded-xl border bg-card p-4 max-md:fixed max-md:inset-0 max-md:z-50 max-md:overflow-y-auto max-md:rounded-none max-md:border-0 xl:sticky xl:top-4 xl:w-[24rem] xl:shrink-0"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                  <p className="text-xs text-muted-foreground">{tCard("reference", { id: selected.id })}</p>
                  <h2 className="text-lg font-semibold">
                    {range({ start: selected.startsAt, end: selected.endsAt })} · {selected.serviceName}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {tCard("with", { staff: selected.staffName })} · {selected.locationName}
                  </p>
                </div>
                <Link
                  href={href({ appt: null })}
                  scroll={false}
                  aria-label={t("panel.close")}
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </Link>
              </div>
              <StatusPill tone={STATUS_TONE[selected.status]}>{tStatus(selected.status)}</StatusPill>
              <div className="space-y-0.5 border-t pt-3 text-sm">
                <p className="font-medium">{selected.clientName}</p>
                <p className="text-muted-foreground">
                  {selected.clientPhone}
                  {selected.clientEmail ? ` · ${selected.clientEmail}` : ""}
                </p>
                <Link href={`/admin/appointments/list?client=${selected.clientId}`} className={cn(textAction(), "min-h-9")}>
                  {tCard("allClientAppointments")}
                </Link>
              </div>
              <div className="space-y-2 border-t pt-3">
                <AppointmentDetail
                  data={selected}
                  locale={locale}
                  zone={zone}
                  currency={config.currency}
                  salonName={config.name}
                  phoneCountryCode={config.phoneCountryCode}
                  now={nowMs}
                  actionable={selected.status === "pending_deposit" || selected.startsAt.getTime() > nowMs}
                  canValidate={can(role, "deposits.manage")}
                  canCancel={can(role, "appointments.manage")}
                  canResend={can(role, "appointments.manage")}
                  canRetryKoibox={can(role, "appointments.manage")}
                  layout="stack"
                />
              </div>
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
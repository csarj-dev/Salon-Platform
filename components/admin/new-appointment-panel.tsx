"use client";

import { useEffect, useId, useMemo, useState, useTransition } from "react";
import { DateTime } from "luxon";
import { useTranslations } from "next-intl";
import { findClientByPhoneAction } from "@/app/[locale]/admin/(panel)/appointments/actions";
import { Link } from "@/i18n/navigation";
import {
  DURATION_MAX_MIN, DURATION_STEP_MIN, SERVICES_MAX, bookableServices, type BookingCatalog,
} from "@/lib/booking-catalog";
import { formatPrice, formatTime } from "@/lib/format";
import type { ClientLookup } from "@/lib/staff-booking";
import { cn } from "@/lib/utils";
import { duration } from "./agenda-ui";
import { Dot } from "./panel-ui";

export type NewAppointmentPanelProps = {
  catalog: BookingCatalog;
  // Lo que viene puesto: desde un hueco libre, profesional, día y hora; desde el botón, lo que haya
  initial: { staffId: number | null; locationId: number | null; date: string; time: string };
  gap: { start: string; end: string } | null; // el hueco libre pulsado (ISO), para el encabezado
  accounts: Record<string, { label: string; color: string | null }>; // cuentas de Koibox (vacío sin Koibox)
  closeHref: string;
  locale: string;
  zone: string;
  currency: string;
};

const fieldClass =
  "h-11 w-full rounded-lg border bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60";
const labelClass = "block text-sm font-semibold";
const stepClass =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-lg border bg-card text-lg outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40";

// Panel «Nueva cita» (tablero «Agenda · crear cita»): profesional, día y hora, la clienta por
// teléfono, los servicios seguidos y la duración. El depósito y «Crear cita» llegan en C2b.
export function NewAppointmentPanel(p: NewAppointmentPanelProps) {
  const t = useTranslations("Admin.agenda.newAppointment");
  const id = useId();

  const [staffId, setStaffId] = useState<number | null>(p.initial.staffId ?? p.catalog.staff[0]?.id ?? null);
  const [locationId, setLocationId] = useState<number | null>(p.initial.locationId ?? p.catalog.locations[0]?.id ?? null);
  const [date, setDate] = useState(p.initial.date);
  const [time, setTime] = useState(p.initial.time);
  const [phone, setPhone] = useState("");
  const [lookup, setLookup] = useState<{ phone: string; client: ClientLookup } | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [serviceIds, setServiceIds] = useState<number[]>([]);
  // null = la suma de los servicios; un número = la que puso recepción
  const [customDuration, setCustomDuration] = useState<number | null>(null);
  const [searching, startSearch] = useTransition();

  const offered = useMemo(
    () => bookableServices(p.catalog, staffId, locationId),
    [p.catalog, staffId, locationId],
  );
  // Si se cambia de profesional o de local, los que ya no se pueden elegir se quedan fuera
  const chosen = serviceIds.flatMap((sid) => offered.filter((s) => s.id === sid));
  const remaining = offered.filter((s) => !serviceIds.includes(s.id));
  const sum = chosen.reduce((m, s) => m + s.durationMin, 0);
  const durationMin = customDuration ?? sum;
  const price = chosen.reduce((c, s) => c + s.priceCents, 0);

  const member = p.catalog.staff.find((s) => s.id === staffId);
  const account = member?.koiboxAccount ? p.accounts[member.koiboxAccount] : undefined;

  const start = /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time)
    ? DateTime.fromISO(`${date}T${time}`, { zone: p.zone })
    : null;
  const end = start?.isValid && durationMin > 0 ? start.plus({ minutes: durationMin }) : null;
  const gapStart = p.gap ? new Date(p.gap.start) : null;
  const gapEnd = p.gap ? new Date(p.gap.end) : null;
  const hm = (d: Date) => formatTime(d, p.locale, p.zone);
  const money = (cents: number) => formatPrice(cents, p.locale, p.currency);

  // Buscar a la clienta en cuanto el teléfono parece completo (9 cifras o más)
  useEffect(() => {
    if (phone.replace(/\D/g, "").length < 9) return;
    const timer = setTimeout(() => {
      startSearch(async () => {
        const client = await findClientByPhoneAction(phone);
        setLookup({ phone, client });
        if (client) {
          // Rellena lo que esté vacío; lo que ya escribió recepción no se toca
          setName((n) => n || client.name);
          setEmail((e) => e || (client.email ?? ""));
        }
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [phone]);
  // undefined = aún no se sabe; null = no está
  const known = lookup && lookup.phone === phone ? lookup.client : undefined;

  const addService = (sid: number) => {
    if (!Number.isInteger(sid) || sid <= 0) return;
    setServiceIds((list) => [...list.filter((x) => offered.some((s) => s.id === x)), sid]);
  };
  const removeService = (sid: number) => setServiceIds((list) => list.filter((x) => x !== sid));
  const stepDuration = (dir: 1 | -1) => {
    const base = durationMin || sum || 0;
    const next = Math.round((base + dir * DURATION_STEP_MIN) / DURATION_STEP_MIN) * DURATION_STEP_MIN;
    setCustomDuration(Math.min(DURATION_MAX_MIN, Math.max(DURATION_STEP_MIN, next)));
  };

  return (
    <div className="space-y-5">
      {/* ---- Encabezado ---- */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {gapStart && gapEnd && (
            <p className="text-xs font-medium uppercase tracking-wide text-success">
              {t("gapKicker", {
                time: `${hm(gapStart)}–${hm(gapEnd)}`,
                duration: duration((gapEnd.getTime() - gapStart.getTime()) / 60_000),
              })}
            </p>
          )}
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          {member && start?.isValid && (
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              {account && <Dot color={account.color} />}
              <span>{t("with", { staff: member.name, day: start.setLocale(p.locale).toFormat("cccc d LLL") })}</span>
              {account && <span>· {t("koiboxAccount", { account: account.label })}</span>}
            </p>
          )}
        </div>
        <Link
          href={p.closeHref}
          scroll={false}
          aria-label={t("close")}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </Link>
      </div>

      {/* ---- Con quién, dónde y cuándo ---- */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`${id}-staff`} className={labelClass}>{t("staff")}</label>
          <select
            id={`${id}-staff`}
            value={staffId ?? ""}
            onChange={(e) => setStaffId(Number(e.target.value) || null)}
            className={fieldClass}
          >
            {p.catalog.staff.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        {p.catalog.locations.length > 1 && (
          <div className="space-y-1.5">
            <label htmlFor={`${id}-location`} className={labelClass}>{t("location")}</label>
            <select
              id={`${id}-location`}
              value={locationId ?? ""}
              onChange={(e) => setLocationId(Number(e.target.value) || null)}
              className={fieldClass}
            >
              {p.catalog.locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
        )}
        <div className="space-y-1.5">
          <label htmlFor={`${id}-date`} className={labelClass}>{t("date")}</label>
          <input id={`${id}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} className={fieldClass} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${id}-time`} className={labelClass}>{t("start")}</label>
          <input
            id={`${id}-time`}
            type="time"
            step={DURATION_STEP_MIN * 60}
            value={time}
            onChange={(e) => setTime(e.target.value.slice(0, 5))}
            className={fieldClass}
          />
        </div>
      </div>

      {/* ---- La clienta ---- */}
      <div className="space-y-2">
        <label htmlFor={`${id}-phone`} className={labelClass}>{t("phone")}</label>
        <input
          id={`${id}-phone`}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className={fieldClass}
        />
        <p aria-live="polite" className="min-h-5 text-sm">
          {searching ? (
            <span className="text-muted-foreground">{t("searching")}</span>
          ) : known ? (
            <span className="font-medium text-success">{t("found", { count: known.appointments })}</span>
          ) : known === null ? (
            <span className="text-muted-foreground">{t("newClient")}</span>
          ) : null}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor={`${id}-name`} className="block text-sm font-medium">{t("name")}</label>
            <input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" className={fieldClass} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${id}-email`} className="block text-sm font-medium">{t("email")}</label>
            <input id={`${id}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" className={fieldClass} />
          </div>
        </div>
      </div>

      {/* ---- Servicios, seguidos y en orden ---- */}
      <div className="space-y-2">
        <p id={`${id}-services`} className={labelClass}>{t("services")}</p>
        {offered.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noServices", { staff: member?.name ?? "" })}</p>
        ) : (
          <div role="group" aria-labelledby={`${id}-services`} className="overflow-hidden rounded-lg border bg-card">
            {chosen.map((s) => (
              <div key={s.id} className="flex items-center gap-3 border-b px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {s.durationMin} min · {money(s.priceCents)}
                </span>
                <button
                  type="button"
                  onClick={() => removeService(s.id)}
                  aria-label={t("remove", { service: s.name })}
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
            ))}
            {remaining.length > 0 && chosen.length < SERVICES_MAX && (
              <div className="p-2">
                <label htmlFor={`${id}-add`} className="sr-only">{t("addService")}</label>
                <select
                  id={`${id}-add`}
                  value=""
                  onChange={(e) => addService(Number(e.target.value))}
                  className={cn(fieldClass, "border-dashed")}
                >
                  <option value="">{chosen.length === 0 ? t("choose") : t("addAnother")}</option>
                  {remaining.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {s.durationMin} min · {money(s.priceCents)}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}
        {chosen.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {t("servicesHint")} {t("total", { price: money(price) })}
          </p>
        )}
      </div>

      {/* ---- Duración: la suma, ajustable de 5 en 5 ---- */}
      <div className="space-y-2">
        <p id={`${id}-duration`} className={labelClass}>{t("duration")}</p>
        <div role="group" aria-labelledby={`${id}-duration`} className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => stepDuration(-1)}
            disabled={durationMin <= DURATION_STEP_MIN}
            aria-label={t("less")}
            className={stepClass}
          >
            −
          </button>
          <div className="relative flex-1">
            <label htmlFor={`${id}-minutes`} className="sr-only">{t("durationMinutes")}</label>
            <input
              id={`${id}-minutes`}
              type="number"
              inputMode="numeric"
              min={DURATION_STEP_MIN}
              max={DURATION_MAX_MIN}
              step={DURATION_STEP_MIN}
              value={durationMin || ""}
              onChange={(e) => setCustomDuration(e.target.value === "" ? null : Number(e.target.value))}
              className={cn(fieldClass, "pr-12 text-center font-semibold tabular-nums")}
            />
            <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
              min
            </span>
          </div>
          <button
            type="button"
            onClick={() => stepDuration(1)}
            disabled={durationMin >= DURATION_MAX_MIN}
            aria-label={t("more")}
            className={stepClass}
          >
            +
          </button>
        </div>
        <p className="text-sm">
          {start?.isValid && end && (
            <b className="font-semibold tabular-nums">
              {hm(start.toJSDate())}–{hm(end.toJSDate())}
            </b>
          )}
          {chosen.length > 0 && (
            <>
              {" · "}
              {chosen.length === 1
                ? t("sumOne", { total: sum })
                : t("sum", { parts: chosen.map((s) => s.durationMin).join(" + "), total: sum })}
            </>
          )}
          {customDuration !== null && customDuration !== sum && chosen.length > 0 && (
            <>
              {" · "}
              <button
                type="button"
                onClick={() => setCustomDuration(null)}
                className="font-medium underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("resetTo", { total: sum })}
              </button>
            </>
          )}
        </p>
        {durationMin > 0 && durationMin % DURATION_STEP_MIN !== 0 && (
          <p className="text-sm text-danger">{t("stepError")}</p>
        )}
        {gapEnd && end && end.toJSDate() > gapEnd && (
          <p className="text-sm text-warning">{t("beyondGap", { end: hm(gapEnd) })}</p>
        )}
        <p className="text-xs text-muted-foreground">{t("step")}</p>
      </div>
    </div>
  );
}
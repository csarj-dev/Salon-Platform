"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { DateTime } from "luxon";
import { useTranslations } from "next-intl";
import { freeGapsAction } from "@/app/[locale]/admin/(panel)/appointments/actions";
import { Button } from "@/components/ui/button";
import { DURATION_MAX_MIN, DURATION_STEP_MIN } from "@/lib/booking-catalog";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MoveDialog, type Proposal } from "./agenda-drag";
import { textAction } from "./panel-ui";

// «Mover cita» en la ficha (tablero «Agenda · crear cita y «Mover cita»»): lo mismo que arrastrar,
// para el móvil y el teclado. Termina en el mismo diálogo «¿Mover la cita?».

const MIN = 60_000;

const fieldClass =
  "h-11 w-full rounded-lg border bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const stepClass =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-lg border bg-card text-lg outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40";

export type MoveFormAppointment = {
  id: number;
  staffId: number;
  start: string; // ISO
  end: string;
  client: string;
  service: string;
  hasEmail: boolean;
};

export function MoveAppointmentForm(p: {
  appointment: MoveFormAppointment;
  staff: { id: number; name: string; account: string | null }[];
  accounts: Record<string, { label: string }>;
  locale: string;
  zone: string;
}) {
  const t = useTranslations("Admin.agenda.moveForm");
  const id = useId();
  const a = p.appointment;
  const startMs = Date.parse(a.start);
  const endMs = Date.parse(a.end);
  const original = DateTime.fromMillis(startMs, { zone: p.zone });
  const originalMin = Math.round((endMs - startMs) / MIN);

  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(original.toISODate() ?? "");
  const [time, setTime] = useState(original.toFormat("HH:mm"));
  const [staffId, setStaffId] = useState(a.staffId);
  const [minutes, setMinutes] = useState(originalMin);
  const [gaps, setGaps] = useState<{ start: string; end: string }[] | null>(null);
  const [loadingGaps, startGaps] = useTransition();
  const [proposal, setProposal] = useState<Proposal | null>(null);

  // Huecos libres de esa profesional ese día (sin contar esta cita)
  useEffect(() => {
    if (!open || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    startGaps(async () => {
      setGaps(await freeGapsAction(a.id, staffId, date));
    });
  }, [open, date, staffId, a.id]);

  const hm = (ms: number) => formatTime(new Date(ms), p.locale, p.zone);
  const newStart = /^\d{2}:\d{2}$/.test(time) ? DateTime.fromISO(`${date}T${time}`, { zone: p.zone }) : null;
  const validMinutes =
    minutes >= DURATION_STEP_MIN && minutes <= DURATION_MAX_MIN && minutes % DURATION_STEP_MIN === 0;
  const newStartMs = newStart?.isValid && validMinutes ? newStart.toMillis() : null;
  const newEndMs = newStartMs !== null ? newStartMs + minutes * MIN : null;
  const changed =
    newStartMs !== null && (newStartMs !== startMs || newEndMs !== endMs || staffId !== a.staffId);
  const staffName = p.staff.find((s) => s.id === staffId)?.name ?? "";

  const step = (dir: 1 | -1) =>
    setMinutes((m) =>
      Math.min(
        DURATION_MAX_MIN,
        Math.max(DURATION_STEP_MIN, Math.round((m + dir * DURATION_STEP_MIN) / DURATION_STEP_MIN) * DURATION_STEP_MIN),
      ),
    );

  const reset = () => {
    setOpen(false);
    setDate(original.toISODate() ?? "");
    setTime(original.toFormat("HH:mm"));
    setStaffId(a.staffId);
    setMinutes(originalMin);
    setGaps(null);
  };

  const review = () => {
    if (!changed || newStartMs === null || newEndMs === null) return;
    setProposal({
      block: {
        id: a.id,
        staffId: a.staffId,
        start: startMs,
        end: endMs,
        client: a.client,
        service: a.service,
        hasEmail: a.hasEmail,
      },
      mode: staffId === a.staffId && newStartMs === startMs ? "resize" : "move",
      to: { staffId, start: newStartMs, end: newEndMs },
    });
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={cn(textAction(), "min-h-11")}>
        {t("open")}
      </button>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">{t("title")}</h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`${id}-date`} className="block text-sm font-medium">{t("date")}</label>
          <input id={`${id}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} className={fieldClass} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${id}-staff`} className="block text-sm font-medium">{t("staff")}</label>
          <select
            id={`${id}-staff`}
            value={staffId}
            onChange={(e) => setStaffId(Number(e.target.value))}
            className={fieldClass}
          >
            {p.staff.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${id}-time`} className="block text-sm font-medium">{t("start")}</label>
          <input
            id={`${id}-time`}
            type="time"
            step={DURATION_STEP_MIN * 60}
            value={time}
            onChange={(e) => setTime(e.target.value.slice(0, 5))}
            className={fieldClass}
          />
        </div>
        <div className="space-y-1.5">
          <span id={`${id}-duration`} className="block text-sm font-medium">{t("duration")}</span>
          <div role="group" aria-labelledby={`${id}-duration`} className="flex items-center gap-2">
            <button type="button" onClick={() => step(-1)} disabled={minutes <= DURATION_STEP_MIN} aria-label={t("less")} className={stepClass}>
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
                value={minutes || ""}
                onChange={(e) => setMinutes(Number(e.target.value))}
                className={cn(fieldClass, "pr-12 text-center font-semibold tabular-nums")}
              />
              <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                min
              </span>
            </div>
            <button type="button" onClick={() => step(1)} disabled={minutes >= DURATION_MAX_MIN} aria-label={t("more")} className={stepClass}>
              +
            </button>
          </div>
        </div>
      </div>

      {/* Huecos libres: al pulsar uno, la hora se pone sola */}
      <div className="space-y-1.5">
        <p id={`${id}-gaps`} className="text-xs text-muted-foreground">{t("gapsTitle", { staff: staffName })}</p>
        {loadingGaps || gaps === null ? (
          <p className="text-sm text-muted-foreground">{t("gapsLoading")}</p>
        ) : gaps.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("gapsNone")}</p>
        ) : (
          <div role="group" aria-labelledby={`${id}-gaps`} className="flex flex-wrap gap-1.5">
            {gaps.map((g) => {
              const value = DateTime.fromISO(g.start, { zone: p.zone }).toFormat("HH:mm");
              const active = value === time;
              return (
                <button
                  key={g.start}
                  type="button"
                  onClick={() => setTime(value)}
                  aria-pressed={active}
                  className={cn(
                    "inline-flex h-10 items-center rounded-lg border-[1.5px] border-dashed border-success px-3 text-sm text-success tabular-nums outline-none hover:bg-success/10 focus-visible:ring-2 focus-visible:ring-ring",
                    active && "border-solid bg-success/10 font-semibold",
                  )}
                >
                  {hm(Date.parse(g.start))}–{hm(Date.parse(g.end))}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {newStartMs !== null && newEndMs !== null && (
        <p className="text-sm">
          <b className="font-semibold tabular-nums">
            {t("summary", { time: `${hm(newStartMs)}–${hm(newEndMs)}`, staff: staffName })}
          </b>
          {minutes !== originalMin && (
            <span className="text-muted-foreground">
              {" · "}
              {minutes < originalMin
                ? t("shorter", { from: originalMin, to: minutes })
                : t("longer", { from: originalMin, to: minutes })}
            </span>
          )}
        </p>
      )}
      {!validMinutes && <p className="text-sm text-danger">{t("stepError")}</p>}

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-11 items-center rounded-md border bg-card px-4 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("cancel")}
        </button>
        <Button type="button" onClick={review} disabled={!changed} className="h-11 px-5">
          {t("review")}
        </Button>
      </div>

      {proposal && (
        <MoveDialog
          key={`${proposal.to.staffId}|${proposal.to.start}|${proposal.to.end}`}
          proposal={proposal}
          staff={p.staff}
          accounts={p.accounts}
          locale={p.locale}
          zone={p.zone}
          onClose={() => setProposal(null)}
        />
      )}
    </div>
  );
}
"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

type Props = {
  /** Lo que dice el botón: «Hoy, viernes 13 de noviembre» o «9 nov – 15 nov» */
  label: string;
  /** Día elegido ("2026-11-14"); en la Semana, cualquier día de esa semana */
  value: string;
  today: string;
  locale: string;
  mode: "day" | "week";
  basePath: "/admin/appointments" | "/admin/appointments/week";
  /** Otros parámetros de la URL que se conservan (local, «Todas», ocultas…) */
  keep: Record<string, string>;
  labels: { open: string; previous: string; next: string; today: string; hint: string };
};

const DAY_MS = 86_400_000;
// Fechas como días de calendario (en UTC, para que la zona del navegador no mueva el día)
const parse = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const toIso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);
const mondayOf = (d: Date) => addDays(d, -((d.getUTCDay() + 6) % 7));
const addMonths = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));

// Saltar a cualquier fecha sin ir día a día (diseño «Semana por profesional»): menos clics y,
// en modo Koibox, solo se descarga la semana de destino, no las de en medio.
export function AgendaDatePicker({ label, value, today, locale, mode, basePath, keep, labels }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [first, setFirst] = useState(() => addMonths(parse(value), 0));
  const [pending, startTransition] = useTransition();
  const box = useRef<HTMLDivElement>(null);
  const dialogId = useId();

  // Se cierra con Escape o al pulsar fuera
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const go = (date: string) => {
    const q = new URLSearchParams(keep);
    if (date !== today) q.set("date", date);
    const qs = q.toString();
    setOpen(false);
    startTransition(() => router.push(`${basePath}${qs ? `?${qs}` : ""}`));
  };

  const selected = parse(value);
  const selectedMonday = toIso(mondayOf(selected));
  const isSelected = (d: Date) => (mode === "day" ? toIso(d) === value : toIso(mondayOf(d)) === selectedMonday);

  const monthTitle = (d: Date) =>
    new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
  const fullDate = (d: Date) =>
    new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(d);
  // L M X J V S D, empezando en lunes (el 16-nov-2026 es lunes)
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 10, 16 + i))),
  );

  const month = (start: Date) => {
    const end = addMonths(start, 1);
    const cells: (Date | null)[] = [];
    for (let d = mondayOf(start); d < end; d = addDays(d, 1)) cells.push(d < start ? null : d);
    return { start, cells };
  };

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={dialogId}
        aria-label={`${label} · ${labels.open}`}
        onClick={() => {
          setFirst(addMonths(parse(value), 0));
          setOpen((v) => !v);
        }}
        className={cn(
          "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-lg font-semibold outline-none first-letter:uppercase hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
          pending && "opacity-60",
        )}
      >
        <span className="first-letter:uppercase">{label}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          id={dialogId}
          role="dialog"
          aria-label={labels.open}
          className="absolute top-full left-0 z-50 mt-2 w-[min(36rem,calc(100vw-2rem))] space-y-3 rounded-xl border bg-card p-4 text-sm shadow-xl"
        >
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              aria-label={labels.previous}
              onClick={() => setFirst((d) => addMonths(d, -1))}
              className="inline-flex size-10 cursor-pointer items-center justify-center rounded-md border outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => go(today)}
              className="inline-flex h-10 cursor-pointer items-center rounded-md border px-3 font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              {labels.today}
            </button>
            <button
              type="button"
              aria-label={labels.next}
              onClick={() => setFirst((d) => addMonths(d, 1))}
              className="inline-flex size-10 cursor-pointer items-center justify-center rounded-md border outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              ›
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {[month(first), month(addMonths(first, 1))].map(({ start, cells }, idx) => (
              <div key={toIso(start)} className={cn("space-y-1.5", idx === 1 && "max-sm:hidden")}>
                <p className="text-center font-semibold first-letter:uppercase">{monthTitle(start)}</p>
                <div className="grid grid-cols-7 gap-0.5 text-center">
                  {weekdays.map((w, i) => (
                    <span key={i} aria-hidden className="py-1 text-xs text-muted-foreground uppercase">
                      {w}
                    </span>
                  ))}
                  {cells.map((d, i) =>
                    d ? (
                      <button
                        key={i}
                        type="button"
                        onClick={() => go(toIso(d))}
                        aria-label={fullDate(d)}
                        aria-current={toIso(d) === today ? "date" : undefined}
                        aria-pressed={isSelected(d)}
                        className={cn(
                          "inline-flex h-9 cursor-pointer items-center justify-center rounded-md tabular-nums outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                          isSelected(d) && "bg-foreground text-background hover:bg-foreground/90",
                          toIso(d) === today && !isSelected(d) && "font-semibold text-success ring-1 ring-success/60",
                        )}
                      >
                        {d.getUTCDate()}
                      </button>
                    ) : (
                      <span key={i} />
                    ),
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{labels.hint}</p>
        </div>
      )}
    </div>
  );
}
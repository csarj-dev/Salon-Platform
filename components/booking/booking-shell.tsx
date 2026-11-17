import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { Chosen, type BookingHref } from "@/components/booking/step-ui";
import { depositForServices } from "@/lib/deposit";
import { formatDuration, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

// Lo elegido hasta ahora: lo pintan las filas de arriba (móvil) y «Tu cita» (ordenador)
export type PickedSummary = {
  location?: { name: string; changeHref?: BookingHref }; // sin enlace si solo hay un local
  services?: {
    label: string; // "Laminado de cejas + Diseño de cejas"
    lines: { name: string; price: string }[];
    duration: string; // "1 h 30 min"
    price: string; // la suma
    deposit: string | null; // uno por categoría
    changeHref?: BookingHref;
  };
  staff?: { name: string; changeHref: BookingHref };
  when?: { label: string; changeHref: BookingHref };
};

export type SummaryLabels = {
  title: string;
  location: string;
  services: string;
  staff: string;
  when: string;
  notChosen: string;
  change: string;
  total: string;
  deposit: string;
  noServices: string;
};

export type StepNames = { aria: string; steps: string[] };

type SummaryService = {
  name: string;
  durationMin: number;
  priceCents: number;
  categoryId: number | null;
  depositCents: number | null;
};

// Lo que suman los servicios elegidos, ya con formato
export function summarizeServices(
  services: SummaryService[],
  locale: string,
  currency: string,
  changeHref?: BookingHref,
): NonNullable<PickedSummary["services"]> {
  const money = (cents: number) => formatPrice(cents, locale, currency);
  const deposit = depositForServices(services);
  return {
    label: services.map((s) => s.name).join(" + "),
    lines: services.map((s) => ({ name: s.name, price: money(s.priceCents) })),
    duration: formatDuration(services.reduce((sum, s) => sum + s.durationMin, 0)),
    price: money(services.reduce((sum, s) => sum + s.priceCents, 0)),
    deposit: deposit ? money(deposit) : null,
    changeHref,
  };
}

// Pasos 1–4. En el móvil solo se lee el nombre del paso actual; los hechos llevan ✓.
export function Stepper({ current, names }: { current: number; names: StepNames }) {
  return (
    <ol aria-label={names.aria} className="flex items-center gap-2">
      {names.steps.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const on = n === current;
        return (
          <li
            key={label}
            aria-current={on ? "step" : undefined}
            className={cn("flex items-center gap-2", i < names.steps.length - 1 && "flex-1")}
          >
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                done || on ? "bg-primary text-primary-foreground" : "border text-muted-foreground",
              )}
            >
              {done ? "✓" : n}
            </span>
            <span className={cn("text-sm whitespace-nowrap", on ? "font-medium" : "hidden text-muted-foreground sm:inline")}>
              {label}
            </span>
            {i < names.steps.length - 1 && <span aria-hidden="true" className="h-px min-w-3 flex-1 bg-border" />}
          </li>
        );
      })}
    </ol>
  );
}

// Filas de lo ya elegido, con «Cambiar» (arriba del paso; en el ordenador las sustituye «Tu cita»)
export function PickedRows({ summary, labels }: { summary: PickedSummary; labels: SummaryLabels }) {
  return (
    <>
      {summary.location?.changeHref && (
        <Chosen
          caption={labels.location}
          label={summary.location.name}
          changeHref={summary.location.changeHref}
          changeText={labels.change}
        />
      )}
      {summary.services?.changeHref && (
        <Chosen
          caption={labels.services}
          label={`${summary.services.label} · ${summary.services.duration}`}
          changeHref={summary.services.changeHref}
          changeText={labels.change}
        />
      )}
      {summary.staff && (
        <Chosen caption={labels.staff} label={summary.staff.name} changeHref={summary.staff.changeHref} changeText={labels.change} />
      )}
      {summary.when && (
        <Chosen caption={labels.when} label={summary.when.label} changeHref={summary.when.changeHref} changeText={labels.change} />
      )}
    </>
  );
}

// «Tu cita»: la columna derecha en el ordenador
export function YourAppointment({
  summary,
  labels,
  footer,
}: {
  summary: PickedSummary;
  labels: SummaryLabels;
  footer?: ReactNode;
}) {
  const row = (caption: string, value: string | undefined, href?: BookingHref) => (
    <div className="flex items-start justify-between gap-3 border-b py-2.5">
      <span className="min-w-0">
        <span className="block text-xs text-muted-foreground">{caption}</span>
        <span className={cn("block text-sm", value ? "font-medium" : "text-muted-foreground")}>
          {value ?? labels.notChosen}
        </span>
      </span>
      {value && href && (
        <Link href={href} className="shrink-0 text-sm underline underline-offset-4">
          {labels.change}
        </Link>
      )}
    </div>
  );
  const s = summary.services;

  return (
    <div className="space-y-4 rounded-xl border bg-card p-5">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{labels.title}</p>
      <div>
        {summary.location && row(labels.location, summary.location.name, summary.location.changeHref)}
        {row(labels.services, s?.label, s?.changeHref)}
        {row(labels.staff, summary.staff?.name, summary.staff?.changeHref)}
        {row(labels.when, summary.when?.label, summary.when?.changeHref)}
      </div>
      {s ? (
        <div className="space-y-3 text-sm">
          <ul className="space-y-1">
            {s.lines.map((l, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span className="text-muted-foreground">{l.name}</span>
                <span>{l.price}</span>
              </li>
            ))}
          </ul>
          <div className="space-y-1 border-t pt-3">
            <p className="flex justify-between gap-3 font-medium">
              <span>{labels.total}</span>
              <span>
                {s.duration} · {s.price}
              </span>
            </p>
            {s.deposit && (
              <p className="flex justify-between gap-3">
                <span className="text-muted-foreground">{labels.deposit}</span>
                <span>{s.deposit}</span>
              </p>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{labels.noServices}</p>
      )}
      {footer}
    </div>
  );
}

// El marco de cada paso: pasos arriba, filas de lo elegido, el paso y, en el ordenador, «Tu cita»
export function BookingShell({
  step,
  names,
  picked,
  aside,
  children,
}: {
  step: number;
  names: StepNames;
  picked?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <Stepper current={step} names={names} />
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-10">
        <div className="min-w-0 space-y-6">
          {picked && <div className={cn("space-y-2 empty:hidden", aside && "lg:hidden")}>{picked}</div>}
          {children}
        </div>
        {aside && <aside className="hidden lg:sticky lg:top-6 lg:block">{aside}</aside>}
      </div>
    </div>
  );
}
import { DateTime } from "luxon";
import type { AppointmentStatus } from "@/lib/appointment-list";

// Piezas comunes de la Agenda (Día y Semana): mismos colores y mismas reglas en las dos.

/** Lo que se ve en la agenda: lo que ocupa hueco o ya pasó. Canceladas y caducadas, en la Lista. */
export const AGENDA_STATUSES: AppointmentStatus[] = ["booked", "pending_deposit", "completed", "no_show"];

/** Bloques de la vista de Día: los mismos colores que las pastillas de estado de la Lista */
export const BLOCK_TONE: Record<AppointmentStatus, string> = {
  booked: "border-success/50 bg-success/20",
  pending_deposit: "border-dashed border-warning bg-warning/12",
  completed: "border-border bg-muted",
  no_show: "border-danger/40 bg-danger/10",
  cancelled: "border-border bg-muted",
  expired: "border-border bg-muted",
};

/** Tramos de la barra de cada día en la Semana: mismos colores, más intensos (la barra es fina) */
export const SEG_TONE: Record<AppointmentStatus, string> = {
  booked: "bg-success/60",
  pending_deposit: "bg-warning/35 ring-1 ring-inset ring-warning",
  completed: "bg-border",
  no_show: "bg-danger/45",
  cancelled: "bg-muted",
  expired: "bg-muted",
};

/** Fuera de turno (rayado gris) */
export const STRIPES = "repeating-linear-gradient(135deg, var(--muted) 0 6px, transparent 6px 12px)";
/** Ausencias y bloqueos en la barra de la Semana (rayado ámbar) */
export const ABSENCE_STRIPES =
  "repeating-linear-gradient(135deg, color-mix(in oklab, var(--warning) 45%, transparent) 0 4px, transparent 4px 8px)";
/** Bloqueos de Koibox en la vista de Día */
export const BLOCK_STYLE = "bg-foreground/[0.07]";

export const navBase =
  "inline-flex h-11 items-center justify-center rounded-md border bg-card font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring";

export const positiveId = (v: string | undefined) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 2_147_483_647 ? n : undefined;
};

export const isDay = (v: string | undefined): v is string =>
  v !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(v) && DateTime.fromISO(v).isValid;

/** «2 h», «1 h 30», «45 min» */
export function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h && m ? `${h} h ${m}` : h ? `${h} h` : `${m} min`;
}
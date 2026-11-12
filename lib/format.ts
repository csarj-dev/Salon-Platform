export function formatPrice(cents: number, locale: string, currency: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}

// Las fechas se muestran siempre en la zona horaria del salón, no en la del visitante

// "10:30" (es) o "10:30 AM" (en)
export function formatTime(date: Date, locale: string, zone: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: zone,
  }).format(date);
}

// "lunes, 2 de noviembre"
export function formatDayLong(date: Date, locale: string, zone: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: zone,
  }).format(date);
}

// Para los botones de día: { weekday: "lun", day: "2", month: "nov" }
export function formatDayChip(
  date: Date,
  locale: string,
  zone: string,
): { weekday: string; day: string; month: string } {
  return {
    weekday: new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: zone }).format(date),
    day: new Intl.DateTimeFormat(locale, { day: "numeric", timeZone: zone }).format(date),
    month: new Intl.DateTimeFormat(locale, { month: "short", timeZone: zone }).format(date),
  };
}

// "lunes, 2 de noviembre, 10:30"
export function formatDateTime(date: Date, locale: string, zone: string): string {
  return `${formatDayLong(date, locale, zone)}, ${formatTime(date, locale, zone)}`;
}

// Cuánto falta para un plazo, para decirlo como "en 1 h 20 min". Redondea hacia arriba:
// con 30 segundos por delante se dice "en 1 min", no "en 0 min".
export type TimeLeft =
  | { kind: "overdue" }
  | { kind: "minutes"; minutes: number }
  | { kind: "hours"; hours: number; minutes: number }
  | { kind: "days"; days: number; hours: number };

export function timeLeftParts(ms: number): TimeLeft {
  if (ms <= 0) return { kind: "overdue" };
  const totalMinutes = Math.ceil(ms / 60_000);
  if (totalMinutes < 60) return { kind: "minutes", minutes: totalMinutes };
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) return { kind: "hours", hours: totalHours, minutes: totalMinutes % 60 };
  return { kind: "days", days: Math.floor(totalHours / 24), hours: totalHours % 24 };
}
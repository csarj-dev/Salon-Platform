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

import { DateTime } from "luxon";

// Convierte una fecha y hora locales del salón en un instante real
export function localToInstant(date: string, time: string, zone: string): Date {
  const dt = DateTime.fromISO(`${date}T${time}`, { zone });
  if (!dt.isValid) {
    throw new Error(`Fecha u hora inválida: ${date} ${time} (${dt.invalidReason})`);
  }
  return dt.toJSDate();
} 
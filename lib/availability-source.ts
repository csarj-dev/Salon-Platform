// Punto único de la reserva web para pedir huecos, venga de nuestra base o de Koibox
// según booking.availability del config (o BOOKING_AVAILABILITY en el .env).
// La pantalla y la acción de reservar solo hablan con este archivo.
import { DateTime } from "luxon";
import { getAvailabilityForRange } from "./availability-range";
import { getAvailabilityForService, type ServiceAvailability } from "./availability-service";
import { confirmKoiboxSlot, getKoiboxAvailabilityForRange } from "./availability-koibox";
import { cachedKoiboxSnapshot, freshKoiboxSnapshot } from "./koibox/snapshot-cache";
import { toAvailabilityOptions, type SalonConfig } from "./salon-config";

export { KoiboxUnavailableError } from "./availability-koibox";

// Huecos de todos los días entre `from` y `to` (fechas locales del salón, incluidas)
export function getBookingAvailability(
  config: SalonConfig,
  locationId: number,
  serviceId: number,
  from: string,
  to: string,
  now: Date,
): Promise<Map<string, ServiceAvailability>> {
  const opts = toAvailabilityOptions(config);
  if (config.booking.availability === "koibox") {
    return getKoiboxAvailabilityForRange(locationId, serviceId, from, to, opts, now, config.koibox, cachedKoiboxSnapshot);
  }
  return getAvailabilityForRange(locationId, serviceId, from, to, opts, now);
}

// ¿Sigue libre esa hora? Devuelve la profesional que la atiende o null.
// - Modo local: con "cualquiera" se busca la primera libre; con una concreta se devuelve tal cual
//   (createAppointment vuelve a comprobar el hueco dentro de la transacción).
// - Modo Koibox: se comprueba con datos frescos de Koibox, sin caché.
export async function confirmBookingSlot(
  config: SalonConfig,
  locationId: number,
  serviceId: number,
  staffChoice: number | "any",
  at: Date,
  now: Date,
): Promise<number | null> {
  const opts = toAvailabilityOptions(config);
  if (config.booking.availability === "koibox") {
    return confirmKoiboxSlot(locationId, serviceId, staffChoice, at, opts, now, config.koibox, freshKoiboxSnapshot);
  }
  if (staffChoice !== "any") return staffChoice;
  const day = DateTime.fromJSDate(at, { zone: config.timezone }).toFormat("yyyy-MM-dd");
  const availability = await getAvailabilityForService(locationId, serviceId, day, opts, now);
  const slot = availability.any.find((s) => s.startsAt.getTime() === at.getTime());
  return slot ? slot.staffIds[0] : null;
}
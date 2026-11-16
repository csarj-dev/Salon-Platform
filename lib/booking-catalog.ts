// Lo que necesita el panel «Nueva cita» para elegir profesional, local y servicios sin pedir nada
// más al servidor. Datos planos (se pasan a un componente de cliente) y lógica pura: sin base de
// datos, para que el panel pueda importarlo. La carga está en lib/booking-catalog-db.ts.

// Límites de las citas de recepción (los usa también lib/staff-booking.ts)
export const DURATION_STEP_MIN = 5;
export const DURATION_MAX_MIN = 480;
export const SERVICES_MAX = 6;

export type CatalogService = {
  id: number;
  name: string;
  durationMin: number;
  priceCents: number;
  depositCents: number | null;
  categoryId: number | null;
};

export type BookingCatalog = {
  locations: { id: number; name: string }[]; // abiertos
  staff: { id: number; name: string; koiboxAccount: string | null }[]; // activas
  services: CatalogService[]; // en el orden de la carta
  offers: { locationId: number; serviceId: number; priceCents: number | null }[]; // qué ofrece cada local (y su precio propio)
  skills: { staffId: number; serviceId: number }[]; // qué hace cada profesional
};

// Los servicios que se pueden poner a esa profesional en ese local, con el precio del local
export function bookableServices(
  catalog: BookingCatalog,
  staffId: number | null,
  locationId: number | null,
): CatalogService[] {
  if (staffId === null || locationId === null) return [];
  return catalog.services.flatMap((s) => {
    const offer = catalog.offers.find((o) => o.locationId === locationId && o.serviceId === s.id);
    const does = catalog.skills.some((k) => k.staffId === staffId && k.serviceId === s.id);
    return offer && does ? [{ ...s, priceCents: offer.priceCents ?? s.priceCents }] : [];
  });
}
import { flowQuery } from "./booking-flow";

export type BookingChannel = "online" | "whatsapp";

// Lo que el componente debe pintar. `labelKey` es una clave del namespace "Showcase".
export type BookingCta =
  | { type: "whatsapp"; href: string; labelKey: "whatsappBook" | "whatsappConsult" }
  | {
      type: "internal";
      href: { pathname: "/booking"; query: ReturnType<typeof flowQuery> };
      labelKey: "book";
    };

type Input = {
  channels: BookingChannel[];
  service: { id: number; requiresConsultation: boolean };
  locationId: number;
  // Enlaces de WhatsApp ya construidos (null = el salón no tiene WhatsApp)
  whatsapp: { book: string; consult: string } | null;
};

// El primer elemento es la acción principal; el segundo, la alternativa.
export function resolveBookingCta({
  channels, service, locationId, whatsapp,
}: Input): BookingCta[] {
  // Sin canales activos, la web es solo informativa
  if (channels.length === 0) return [];

  // Lo que pide consulta previa no se reserva solo: siempre por mensaje
  if (service.requiresConsultation) {
    return whatsapp
      ? [{ type: "whatsapp", href: whatsapp.consult, labelKey: "whatsappConsult" }]
      : [];
  }

  const ctas: BookingCta[] = [];
  if (channels.includes("online")) {
    ctas.push({
      type: "internal",
      href: {
        pathname: "/booking",
        query: flowQuery({ location: locationId, service: service.id }),
      },
      labelKey: "book",
    });
  }
  if (channels.includes("whatsapp") && whatsapp) {
    ctas.push({ type: "whatsapp", href: whatsapp.book, labelKey: "whatsappBook" });
  }
  return ctas;
}
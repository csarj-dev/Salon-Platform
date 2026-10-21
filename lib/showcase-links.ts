import { buildWhatsAppLink } from "./whatsapp-link";
import type { BookingChannel } from "./booking-cta";

// Enlaces de WhatsApp de un servicio (reserva y consulta), o null si el salón no tiene número
export function serviceWhatsApp(
  phone: string | undefined,
  messages: { book: string; consult: string },
): { book: string; consult: string } | null {
  if (!phone) return null;
  return {
    book: buildWhatsAppLink(phone, messages.book),
    consult: buildWhatsAppLink(phone, messages.consult),
  };
}

export type HeroCta =
  | { type: "internal"; href: "/booking" | "/services"; labelKey: "book" | "viewMenu" }
  | { type: "whatsapp"; href: string; labelKey: "whatsappBook" };

// Botón principal de la portada:
//  - con canal online: ir a reservar
//  - si no, con canal whatsapp: abrir WhatsApp
//  - si no, ir a la carta
export function heroCta({
  channels,
  whatsappHref,
}: {
  channels: BookingChannel[];
  whatsappHref: string | null;
}): HeroCta {
  if (channels.includes("online")) {
    return { type: "internal", href: "/booking", labelKey: "book" };
  }
  if (channels.includes("whatsapp") && whatsappHref) {
    return { type: "whatsapp", href: whatsappHref, labelKey: "whatsappBook" };
  }
  return { type: "internal", href: "/services", labelKey: "viewMenu" };
}

// "@theroom.estudio" o "theroom.estudio" -> https://www.instagram.com/theroom.estudio/
export function instagramUrl(handle: string): string {
  return `https://www.instagram.com/${handle.replace(/^@/, "").replace(/\/+$/, "")}/`;
}
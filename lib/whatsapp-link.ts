// Enlace para abrir un chat de WhatsApp con el texto ya escrito.
// `phone` puede traer espacios, "+" o guiones; wa.me solo admite dígitos.
export function buildWhatsAppLink(phone: string, message?: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 0) {
    throw new Error("El teléfono de WhatsApp no tiene ningún dígito");
  }
  const base = `https://wa.me/${digits}`;
  const text = message?.trim();
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}
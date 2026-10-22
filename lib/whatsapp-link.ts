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

// Convierte el teléfono que escribió la clienta en el número internacional que pide wa.me.
// Con "+" o "00" ya trae el prefijo; con 11 o más dígitos también; si no, se le añade
// el prefijo del país del salón (`phoneCountryCode`, sin "+", por ejemplo "34").
export function toWhatsAppNumber(phone: string, countryCode: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 0) {
    throw new Error("El teléfono no tiene ningún dígito");
  }
  if (trimmed.startsWith("+")) return digits;
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.length >= 11) return digits;
  return `${countryCode}${digits}`;
}
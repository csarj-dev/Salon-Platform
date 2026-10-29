// Teléfonos entre nuestra app y Koibox.
// Nosotros guardamos lo que escribió la clienta sin espacios ("612345678" o "+34612345678").
// En Koibox el móvil va sin prefijo y el prefijo aparte (prefijo_tel), pero recepción
// puede haberlo escrito con espacios o con el prefijo delante. Koibox solo busca por
// móvil exacto, así que probamos las formas habituales de escribir el mismo número.

export type SplitPhone = { number: string; prefix: string };

// "+34612345678" -> { number: "612345678", prefix: "34" }; "612345678" -> prefijo del salón
export function splitPhone(phone: string, countryCode: string): SplitPhone {
  let digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;

  if (digits.startsWith("+")) {
    const rest = digits.slice(1);
    if (rest.startsWith(countryCode)) {
      return { number: rest.slice(countryCode.length), prefix: countryCode };
    }
    // Prefijo de otro país: no sabemos cuántas cifras tiene, así que va entero en el número
    return { number: rest, prefix: "" };
  }
  return { number: digits, prefix: countryCode };
}

// Formas de escribir el mismo móvil que buscamos en Koibox (sin repetir)
export function phoneVariants(phone: string, countryCode: string): string[] {
  const { number, prefix } = splitPhone(phone, countryCode);
  const variants = [number];
  // 612 345 678 (como se suele escribir en España)
  if (/^\d{9}$/.test(number)) variants.push(number.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3"));
  if (prefix) variants.push(`+${prefix}${number}`, `${prefix}${number}`, `+${prefix} ${number}`);
  else variants.push(`+${number}`);
  return [...new Set(variants)];
}

// "Laura Gómez Pérez" -> firstName "Laura", lastName "Gómez Pérez"
export function splitName(fullName: string): { firstName: string; lastName?: string } {
  const [firstName, ...rest] = fullName.trim().split(/\s+/);
  return rest.length > 0 ? { firstName, lastName: rest.join(" ") } : { firstName };
}
// Un archivo .ics (iCalendar, RFC 5545) con una cita: lo abren el iPhone, Google Calendar y Outlook.
// Sin dependencias: es texto con un formato fijo.

export type IcsEvent = {
  uid: string; // único y estable para la misma cita (si se descarga dos veces, no se duplica)
  now: Date;
  start: Date;
  end: Date;
  summary: string;
  location?: string;
  description?: string;
};

// 2026-11-18T12:00:00.000Z → 20261118T120000Z (siempre en UTC)
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

// Texto: se escapan \ ; , y los saltos de línea
export function escapeIcsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

// Las líneas de más de 75 bytes se parten; cada trozo siguiente empieza con un espacio
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74; // el espacio del principio también cuenta
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function buildIcs(e: IcsEvent): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//salon-platform//booking//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${stamp(e.now)}`,
    `DTSTART:${stamp(e.start)}`,
    `DTEND:${stamp(e.end)}`,
    `SUMMARY:${escapeIcsText(e.summary)}`,
    ...(e.location ? [`LOCATION:${escapeIcsText(e.location)}`] : []),
    ...(e.description ? [`DESCRIPTION:${escapeIcsText(e.description)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}
import { describe, expect, it } from "vitest";
import { buildIcs } from "./ics";

const event = {
  uid: "appointment-7@salon.test",
  startsAt: new Date("2026-11-02T10:00:00Z"),
  endsAt: new Date("2026-11-02T11:00:00Z"),
  summary: "Cejas · The Room",
  now: new Date("2026-10-20T09:30:15.123Z"),
};

describe("buildIcs", () => {
  it("genera un evento válido con horas en UTC y saltos de línea CRLF", () => {
    const ics = buildIcs(event);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("UID:appointment-7@salon.test\r\n");
    expect(ics).toContain("DTSTAMP:20261020T093015Z\r\n");
    expect(ics).toContain("DTSTART:20261102T100000Z\r\n");
    expect(ics).toContain("DTEND:20261102T110000Z\r\n");
    expect(ics).toContain("SUMMARY:Cejas · The Room\r\n");
    // Ningún salto de línea suelto: todos son CRLF
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("escapa comas, punto y coma, barras y saltos de línea del texto", () => {
    const ics = buildIcs({
      ...event,
      description: "Con Ana; sala 2, planta 1\nhttps://x.test/a\\b",
      location: "Local, Adeje",
    });
    expect(ics).toContain("DESCRIPTION:Con Ana\\; sala 2\\, planta 1\\nhttps://x.test/a\\\\b\r\n");
    expect(ics).toContain("LOCATION:Local\\, Adeje\r\n");
  });

  it("sin descripción ni lugar no pone esas líneas", () => {
    const ics = buildIcs(event);
    expect(ics).not.toContain("DESCRIPTION");
    expect(ics).not.toContain("LOCATION");
  });

  it("parte las líneas largas a 75 bytes, con espacio al inicio de la continuación", () => {
    const ics = buildIcs({ ...event, description: "a".repeat(200) });
    const lines = ics.split("\r\n");
    expect(lines.every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    // Al desdoblar queda el texto completo
    expect(ics.replace(/\r\n /g, "")).toContain(`DESCRIPTION:${"a".repeat(200)}`);
  });

  it("no parte un carácter de varios bytes por la mitad", () => {
    const ics = buildIcs({ ...event, description: "ñ".repeat(120) });
    expect(ics.replace(/\r\n /g, "")).toContain(`DESCRIPTION:${"ñ".repeat(120)}`);
  });
});
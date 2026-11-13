import { describe, it, expect } from "vitest";
import { formatDateTime, formatDayChip, formatDayLong, formatPrice, formatTime, timeLeftParts, calendarDayDiff, formatShortDate } from "./format";

describe("formatPrice", () => {
  it("formatea en euros según el idioma", () => {
    expect(formatPrice(4500, "es", "EUR")).toMatch(/45,00\s?€/);
    expect(formatPrice(4500, "en", "EUR")).toBe("€45.00");
  });

  it("conserva los céntimos", () => {
    expect(formatPrice(1850, "es", "EUR")).toMatch(/18,50/);
  });
});

describe("fechas en la zona horaria del salón", () => {
  const zone = "Atlantic/Canary";
  const winter = new Date("2026-11-02T10:30:00Z"); // en Canarias es UTC+0
  const summer = new Date("2026-06-02T22:30:00Z"); // en Canarias es UTC+1

  it("la hora se muestra en la zona del salón, no en la del servidor", () => {
    expect(formatTime(winter, "es", zone)).toBe("10:30");
    expect(formatTime(summer, "es", zone)).toBe("23:30");
  });

  it("la hora sigue las costumbres del idioma", () => {
    expect(formatTime(winter, "en", zone)).toMatch(/^10:30\sAM$/);
  });

  it("una cita a última hora cae en el día local del salón, no en el UTC", () => {
    // 23:30 hora de Canarias del 2 de junio es ya el 3 de junio en Tokio (zona de otro salón)
    expect(formatDayLong(summer, "es", zone)).toBe("martes, 2 de junio");
    expect(formatDayLong(summer, "es", "Asia/Tokyo")).toBe("miércoles, 3 de junio");
  });

  it("día largo y de botón", () => {
    expect(formatDayLong(winter, "es", zone)).toBe("lunes, 2 de noviembre");
    expect(formatDayLong(winter, "en", zone)).toBe("Monday, November 2");
    expect(formatDayChip(winter, "es", zone)).toEqual({ weekday: "lun", day: "2", month: "nov" });
  });

  it("fecha y hora juntas", () => {
    expect(formatDateTime(winter, "es", zone)).toBe("lunes, 2 de noviembre, 10:30");
  });
});

describe("timeLeftParts", () => {
  const min = 60_000;
  it("plazo vencido, minutos, horas y días", () => {
    expect(timeLeftParts(0)).toEqual({ kind: "overdue" });
    expect(timeLeftParts(-5 * min)).toEqual({ kind: "overdue" });
    expect(timeLeftParts(30_000)).toEqual({ kind: "minutes", minutes: 1 });
    expect(timeLeftParts(80 * min)).toEqual({ kind: "hours", hours: 1, minutes: 20 });
    expect(timeLeftParts(21 * 60 * min)).toEqual({ kind: "hours", hours: 21, minutes: 0 });
    expect(timeLeftParts(26 * 60 * min)).toEqual({ kind: "days", days: 1, hours: 2 });
  });
});

describe("calendarDayDiff", () => {
  it("cuenta días de calendario en la zona del salón, no horas", () => {
    const late = new Date("2026-11-12T23:30:00Z");
    const early = new Date("2026-11-13T00:10:00Z");
    expect(calendarDayDiff(late, early, "Atlantic/Canary")).toBe(1);
    // En Madrid (UTC+1) las dos son el 13 de noviembre
    expect(calendarDayDiff(late, early, "Europe/Madrid")).toBe(0);
  });
  it("mismo día = 0, una semana = 7", () => {
    const d = new Date("2026-11-13T09:00:00Z");
    expect(calendarDayDiff(d, new Date("2026-11-13T20:00:00Z"), "Atlantic/Canary")).toBe(0);
    expect(calendarDayDiff(d, new Date("2026-11-20T09:00:00Z"), "Atlantic/Canary")).toBe(7);
  });
});

describe("formatShortDate", () => {
  const now = new Date("2026-11-13T10:00:00Z");
  it("sin año si es de este año", () => {
    expect(formatShortDate(new Date("2026-11-12T10:00:00Z"), "es", "Atlantic/Canary", now)).toBe("12 nov");
  });
  it("con año si es de otro", () => {
    expect(formatShortDate(new Date("2025-10-03T10:00:00Z"), "es", "Atlantic/Canary", now)).toContain("2025");
  });
});
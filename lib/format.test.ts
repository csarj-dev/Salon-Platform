import { describe, it, expect } from "vitest";
import { formatDateTime, formatDayChip, formatDayLong, formatPrice, formatTime } from "./format";

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


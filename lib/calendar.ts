// Funciones puras del calendario mensual. Trabajan con textos "2026-11" (mes) y "2026-11-02" (día),
// sin zonas horarias ni la hora actual: solo aritmética del calendario.

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isMonthKey(value: string | undefined): value is string {
  return value !== undefined && MONTH.test(value);
}

// "2026-11-02" -> "2026-11"
export function monthOfDay(day: string): string {
  return day.slice(0, 7);
}

// Suma (o resta) meses a "2026-11": ("2026-11", 2) -> "2027-01"
export function addMonths(month: string, n: number): string {
  const m = MONTH.exec(month);
  if (!m) throw new Error(`Mes no válido: ${month}`);
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + n;
  const year = Math.floor(total / 12);
  const mon = (total % 12) + 1;
  return `${String(year).padStart(4, "0")}-${String(mon).padStart(2, "0")}`;
}

// Primer día de la semana del idioma: 1 = lunes ... 7 = domingo.
// es -> 1, en -> 7. Si el navegador/servidor no lo sabe, lunes.
export function firstWeekdayOf(locale: string): number {
  try {
    const l = new Intl.Locale(locale) as unknown as {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const day = (l.getWeekInfo?.() ?? l.weekInfo)?.firstDay;
    return day !== undefined && day >= 1 && day <= 7 ? day : 1;
  } catch {
    return 1;
  }
}

// Los 7 días de la semana empezando por `firstWeekday`: (7) -> [7, 1, 2, 3, 4, 5, 6]
export function weekdayOrder(firstWeekday: number): number[] {
  return Array.from({ length: 7 }, (_, i) => ((firstWeekday - 1 + i) % 7) + 1);
}

// Una fecha cualquiera que cae en ese día de la semana, para poder darle nombre con Intl.
// El 2 de noviembre de 2026 es lunes.
export function referenceDateForWeekday(weekday: number): Date {
  return new Date(Date.UTC(2026, 10, 1 + weekday));
}

// Cuadrícula del mes: filas de 7 celdas. Cada celda es un día ("2026-11-02") o null (hueco vacío
// antes del día 1 y después del último día).
export function monthGrid(month: string, firstWeekday: number): (string | null)[][] {
  const m = MONTH.exec(month);
  if (!m) throw new Error(`Mes no válido: ${month}`);
  const year = Number(m[1]);
  const mon = Number(m[2]);

  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const firstOfMonth = ((new Date(Date.UTC(year, mon - 1, 1)).getUTCDay() + 6) % 7) + 1; // 1 = lunes
  const blanks = (firstOfMonth - firstWeekday + 7) % 7;

  const cells: (string | null)[] = Array.from({ length: blanks }, () => null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(null);

  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}
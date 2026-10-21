export type HoursRow = { weekday: number; openTime: string; closeTime: string };
export type Shift = [string, string]; // ["09:00", "19:30"]
// Días consecutivos (from..to) con exactamente los mismos turnos. Sin turnos = cerrado.
export type HoursGroup = { from: number; to: number; shifts: Shift[] };
export type HoursLine = { days: string; hours: string | null }; // hours null = cerrado

// Postgres devuelve "09:00:00"; nos quedamos con "09:00"
const hhmm = (t: string) => t.slice(0, 5);

function sameShifts(a: Shift[], b: Shift[]): boolean {
  return a.length === b.length && a.every((s, i) => s[0] === b[i][0] && s[1] === b[i][1]);
}

// Recorre lunes (1) a domingo (7) y junta los días contiguos con el mismo horario.
// Dos días iguales separados por otro distinto NO se juntan.
export function groupOpeningHours(rows: HoursRow[]): HoursGroup[] {
  const byDay = new Map<number, Shift[]>();
  for (const r of rows) {
    const list = byDay.get(r.weekday) ?? [];
    list.push([hhmm(r.openTime), hhmm(r.closeTime)]);
    byDay.set(r.weekday, list);
  }

  const groups: HoursGroup[] = [];
  for (let day = 1; day <= 7; day++) {
    const shifts = (byDay.get(day) ?? []).sort((a, b) => a[0].localeCompare(b[0]));
    const last = groups[groups.length - 1];
    if (last && last.to === day - 1 && sameShifts(last.shifts, shifts)) {
      last.to = day;
    } else {
      groups.push({ from: day, to: day, shifts });
    }
  }
  return groups;
}

// 1 de enero de 2024 fue lunes, así que el día N de enero tiene el weekday N
function dayName(weekday: number, locale: string): string {
  const name = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(2024, 0, weekday)))
    .replace(/\.$/, "");
  return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
}

// "Lun–Vie" / "Sáb" y "09:00–19:30 · 16:00–20:00" (o null si está cerrado)
export function formatOpeningHours(groups: HoursGroup[], locale: string): HoursLine[] {
  return groups.map((g) => ({
    days:
      g.from === g.to
        ? dayName(g.from, locale)
        : `${dayName(g.from, locale)}–${dayName(g.to, locale)}`,
    hours: g.shifts.length === 0 ? null : g.shifts.map(([o, c]) => `${o}–${c}`).join(" · "),
  }));
}
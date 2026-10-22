
export type Flow = {
  location?: number;
  service?: number;
  staff?: number | "any";
  from?: string; // primer día de la semana que se muestra, "2026-11-02"
  date?: string; // día elegido, "2026-11-02" (fecha local del salón)
  at?: string;   // hora elegida, instante en UTC: "2026-11-02T10:30:00.000Z"
};

type RawParams = Record<string, string | string[] | undefined>;

function first(v?: string | string[]): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function toId(v?: string | string[]): number | undefined {
  const s = first(v);
  if (!s || !/^\d+$/.test(s)) return undefined;
  const n = Number(s);
  return n > 0 ? n : undefined;
}

// "2026-11-02" y que sea un día real (no "2026-02-31").
// Se comprueba a mano, sin luxon: luxon lee la hora actual al crear fechas y Next
// no deja leerla mientras prerenderiza (esta función corre antes de poder esperar a la petición).
function toDay(v?: string | string[]): string | undefined {
  const s = first(v);
  const m = s ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) : null;
  if (!s || !m) return undefined;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  // "2026-02-31" se desbordaría a marzo y ya no coincidiría con lo escrito
  const same =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  return same ? s : undefined;
}

// Instante en UTC con el formato exacto que genera toISOString()
function toInstant(v?: string | string[]): string | undefined {
  const s = first(v);
  if (!s || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s)) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) || d.toISOString() !== s ? undefined : s;
}

// Lee la URL con tolerancia: lo que no sea válido se ignora
export function parseFlowParams(raw: RawParams): Flow {
  const staffRaw = first(raw.staff);
  return {
    location: toId(raw.location),
    service: toId(raw.service),
    staff: staffRaw === "any" ? "any" : toId(raw.staff),
    from: toDay(raw.from),
    date: toDay(raw.date),
    at: toInstant(raw.at),
  };
}

// Convierte la selección en parámetros de URL, sin los vacíos
export function flowQuery(flow: Flow): Record<string, string> {
  const q: Record<string, string> = {};
  if (flow.location !== undefined) q.location = String(flow.location);
  if (flow.service !== undefined) q.service = String(flow.service);
  if (flow.staff !== undefined) q.staff = String(flow.staff);
  if (flow.from !== undefined) q.from = flow.from;
  if (flow.date !== undefined) q.date = flow.date;
  if (flow.at !== undefined) q.at = flow.at;
  return q;
}

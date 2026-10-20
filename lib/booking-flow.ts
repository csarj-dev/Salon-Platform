export type Flow = {
  location?: number;
  service?: number;
  staff?: number | "any";
};

type RawParams = Record<string, string | string[] | undefined>;

function toId(v?: string | string[]): number | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  if (!s || !/^\d+$/.test(s)) return undefined;
  const n = Number(s);
  return n > 0 ? n : undefined;
}

// Lee la URL con tolerancia: lo que no sea válido se ignora
export function parseFlowParams(raw: RawParams): Flow {
  const staffRaw = Array.isArray(raw.staff) ? raw.staff[0] : raw.staff;
  return {
    location: toId(raw.location),
    service: toId(raw.service),
    staff: staffRaw === "any" ? "any" : toId(raw.staff),
  };
}

// Convierte la selección en parámetros de URL, sin los vacíos
export function flowQuery(flow: Flow): Record<string, string> {
  const q: Record<string, string> = {};
  if (flow.location !== undefined) q.location = String(flow.location);
  if (flow.service !== undefined) q.service = String(flow.service);
  if (flow.staff !== undefined) q.staff = String(flow.staff);
  return q;
}
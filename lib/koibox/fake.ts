// Koibox de mentira: un `fetch` que responde como la API de Koibox, con los datos en memoria.
// Sirve para desarrollar sin clave (KOIBOX_DRIVER=fake) y para los tests.
// Imita lo que nos importa del real: clave por centro, páginas de 50, citas que no se
// pueden pisar, estados, PATCH de la cita y el límite de llamadas por minuto (429).
// También da horarios y bloqueos, y calcula los huecos libres con ellos.
// No imita todo (servicios combinados, ventas...): eso llega en otras entregas.
// Por dentro guarda los datos con nombres nuestros; hacia fuera responde con los de Koibox.
import { WEEKDAY_FIELDS, blockOccursOn, shiftsOn } from "./schedule";
import { KOIBOX_STATUS, freesSlot } from "./statuses";
import type { KoiboxAppointment, KoiboxBlock, KoiboxClient, KoiboxSchedule, KoiboxTag } from "./types";

// Profesional con su horario de siempre: de `from` a `to` los días `days` (1 = lunes).
// Por defecto, de 09:00 a 20:00 de lunes a sábado.
export type FakeUser = { id: number; name: string; from?: string; to?: string; days?: number[] };
export type FakeService = {
  id: number;
  name: string;
  duration: string; // "01:00:00"
  price?: string;
  userIds: number[];
  securePaymentAmount?: number;
  availableOnline?: boolean;
};

// Horario distinto solo una semana (week "01".."53", year "2026"). Día con null = libre.
export type FakeWeekOverride = {
  userId: number;
  week: string;
  year: string;
  days: Partial<Record<number, [string, string] | null>>;
};

export type FakeBlock = { userId: number; date: string; start: string; end: string; recurrence?: string };

export type FakeSeed = {
  name?: string;
  centerId?: number;
  users: FakeUser[];
  services: FakeService[];
  clients?: KoiboxClient[];
  weekOverrides?: FakeWeekOverride[];
  blocks?: FakeBlock[];
};

type StoredAppointment = {
  id: number;
  title: string;
  date: string;
  start: string; // "HH:mm:ss"
  end: string;
  userId: number;
  clientId: number | null;
  serviceIds: number[];
  status: number;
  notes: string;
  tags: KoiboxTag[];
};

type Center = {
  seed: FakeSeed & { centerId: number };
  schedules: KoiboxSchedule[];
  blocks: KoiboxBlock[];
  clients: KoiboxClient[];
  appointments: StoredAppointment[];
  nextId: number;
  calls: number[]; // instantes de las últimas llamadas, para el límite
};

export type FakeOptions = {
  now?: () => number;
  ratePerMinute?: number; // 60 por defecto, como Koibox
  stepMin?: number; // paso de los huecos libres (30 por defecto)
};

type Failure = { status: number; body?: unknown; headers?: Record<string, string> };

// Nombre que da Koibox a cada estado (lo que devuelve en `estado.nombre`)
const STATUS_LABEL: Record<number, string> = {
  1: "Realizada",
  2: "Pendiente",
  3: "Anulada",
  4: "Perdida",
  5: "Anulada por el usuario",
  6: "Sin confirmación",
  7: "En proceso",
  8: "Bonificada",
  9: "Eliminada",
};

const PAGE_MAX = 50;
const REQUIRED = ["Este campo es obligatorio."];

export function createFakeKoibox(centersByKey: Record<string, FakeSeed>, opts: FakeOptions = {}) {
  const now = opts.now ?? (() => Date.now());
  const ratePerMinute = opts.ratePerMinute ?? 60;
  const stepMin = opts.stepMin ?? 30;

  const centers = new Map<string, Center>();
  let nextCenterId = 1000;
  for (const [key, seed] of Object.entries(centersByKey)) {
    const clients = (seed.clients ?? []).map((c) => ({ ...c }));
    const maxId = Math.max(0, ...clients.map((c) => c.id));
    const centerId = seed.centerId ?? ++nextCenterId;
    centers.set(key, {
      seed: { ...seed, centerId },
      schedules: buildSchedules(seed, centerId),
      blocks: (seed.blocks ?? []).map((b, i) => ({
        id: i + 1,
        user: b.userId,
        fecha: b.date,
        hora_inicio: withSeconds(b.start),
        hora_fin: withSeconds(b.end),
        titulo: "Bloqueo",
        recurrencia: b.recurrence ?? "none",
        is_online: false,
      })),
      clients,
      appointments: [],
      nextId: maxId + 1,
      calls: [],
    });
  }

  const failures: Failure[] = [];
  const log: { method: string; path: string; search: string }[] = [];

  function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });
  }

  function page<T>(url: URL, items: T[]): Response {
    const limit = Math.min(Number(url.searchParams.get("limit") ?? PAGE_MAX) || PAGE_MAX, PAGE_MAX);
    const offset = Number(url.searchParams.get("offset") ?? 0) || 0;
    const results = items.slice(offset, offset + limit);
    const more = offset + limit < items.length;
    const next = more ? new URL(url) : null;
    next?.searchParams.set("offset", String(offset + limit));
    return json(200, { count: items.length, next: next?.toString() ?? null, previous: null, results });
  }

  const list = (v: string | null) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);
  const toMinutes = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };
  const toTime = (min: number) =>
    `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}:00`;

  function overlaps(center: Center, a: { userId: number; date: string; start: string; end: string }, exceptId?: number) {
    const start = toMinutes(a.start);
    const end = toMinutes(a.end);
    return center.appointments.some(
      (o) =>
        o.id !== exceptId &&
        o.userId === a.userId &&
        o.date === a.date &&
        !freesSlot(o.status) &&
        toMinutes(o.start) < end &&
        start < toMinutes(o.end),
    );
  }

  // ¿Pisa un bloqueo de esa profesional ese día?
  function blocked(center: Center, a: { userId: number; date: string; start: string; end: string }) {
    const start = toMinutes(a.start);
    const end = toMinutes(a.end);
    return center.blocks.some(
      (b) =>
        b.user === a.userId &&
        blockOccursOn({ date: b.fecha, recurrence: b.recurrencia ?? "none" }, a.date) &&
        toMinutes(b.hora_inicio) < end &&
        start < toMinutes(b.hora_fin),
    );
  }

  // Una cita tal como la devuelve Koibox
  function toKoibox(center: Center, a: StoredAppointment): KoiboxAppointment {
    const user = center.seed.users.find((u) => u.id === a.userId);
    const client = center.clients.find((c) => c.id === a.clientId);
    return {
      id: a.id,
      titulo: a.title,
      fecha: a.date,
      hora_inicio: a.start,
      hora_fin: a.end,
      notas: a.notes,
      user: { value: a.userId, text: user?.name ?? "" },
      cliente: client ? { value: client.id, text: [client.nombre, client.apellido1].filter(Boolean).join(" ") } : null,
      estado: { id: a.status, value: a.status, nombre: STATUS_LABEL[a.status] ?? "" },
      servicios: a.serviceIds.map((id) => ({ id, nombre: center.seed.services.find((s) => s.id === id)?.name ?? "" })),
      tags: a.tags.map((t, i) => ({ id: i + 1, name: t.name })),
      venta: null,
      origen: "api",
    };
  }

  async function handle(method: string, url: URL, body: unknown, center: Center): Promise<Response> {
    const path = url.pathname.replace(/^\/api/, "");

    if (method === "GET" && path === "/api-key/me/") {
      return json(200, {
        name: center.seed.name ?? "Koibox de prueba",
        centro: center.seed.centerId,
        centro_slug: "centro-de-prueba",
      });
    }

    if (method === "GET" && path === "/servicios/") {
      const items = center.seed.services.map((s) => ({
        id: s.id,
        referencia: `S${s.id}`,
        nombre: s.name,
        duracion: s.duration,
        precio: s.price ?? "0.00",
        is_active: true,
        is_disponible_online: s.availableOnline ?? true,
        secure_payment_amount: s.securePaymentAmount ?? 0,
        users: s.userIds.map((id) => ({ value: id, text: center.seed.users.find((u) => u.id === id)?.name ?? "" })),
      }));
      return page(url, items);
    }

    if (method === "GET" && path === "/agenda/horas-disponibles/") {
      const date = url.searchParams.get("fecha");
      const serviceIds = list(url.searchParams.get("servicios")).map(Number);
      if (!date || serviceIds.length === 0) return json(400, { detail: "Faltan fecha o servicios" });
      const services = serviceIds.map((id) => center.seed.services.find((s) => s.id === id));
      if (services.some((s) => !s)) return json(404, { detail: "Servicio no encontrado" });
      const total = services.reduce((sum, s) => sum + toMinutes(s!.duration), 0);
      const userFilter = url.searchParams.get("user");
      const users = center.seed.users.filter(
        (u) => services.every((s) => s!.userIds.includes(u.id)) && (!userFilter || u.id === Number(userFilter)),
      );
      const out: { user: number; hora: string }[] = [];
      for (const u of users) {
        for (const shift of shiftsOn(center.schedules, u.id, date)) {
          for (let t = toMinutes(shift.start); t + total <= toMinutes(shift.end); t += stepMin) {
            const slot = { userId: u.id, date, start: toTime(t), end: toTime(t + total) };
            if (!overlaps(center, slot) && !blocked(center, slot)) out.push({ user: u.id, hora: slot.start.slice(0, 5) });
          }
        }
      }
      // Por defecto Koibox da una sola profesional por hora
      if (url.searchParams.get("is_solapamiento") !== "false") {
        const seen = new Set<string>();
        return json(200, out.filter((h) => !seen.has(h.hora) && seen.add(h.hora)));
      }
      return json(200, out);
    }

    if (method === "GET" && path === "/horarios/") {
      const user = url.searchParams.get("user");
      return page(url, center.schedules.filter((s) => !user || s.user === Number(user)));
    }

    if (method === "GET" && path === "/bloqueos/") {
      const from = url.searchParams.get("fecha__gte")?.slice(0, 10);
      const to = url.searchParams.get("fecha__lte")?.slice(0, 10);
      const items = center.blocks.filter((b) => (!from || b.fecha >= from) && (!to || b.fecha <= to));
      return page(url, items);
    }

    if (method === "GET" && path === "/clientes/") {
      const phone = url.searchParams.get("movil");
      const phones = list(url.searchParams.get("movil__in"));
      const items = center.clients.filter(
        (c) => (!phone || c.movil === phone) && (phones.length === 0 || phones.includes(c.movil ?? "")),
      );
      return page(url, items);
    }

    if (method === "POST" && path === "/clientes/") {
      const input = (body ?? {}) as Partial<KoiboxClient>;
      if (!input.nombre?.trim()) return json(400, { nombre: REQUIRED });
      const client: KoiboxClient = {
        id: center.nextId++,
        nombre: input.nombre,
        apellido1: input.apellido1 ?? "",
        movil: input.movil ?? null,
        prefijo_tel: input.prefijo_tel ?? null,
        email: input.email ?? null,
      };
      center.clients.push(client);
      return json(201, client);
    }

    if (method === "POST" && path === "/agenda/") {
      const input = (body ?? {}) as Record<string, unknown>;
      const missing = ["titulo", "fecha", "hora_inicio", "hora_fin", "user"].filter((k) => !input[k]);
      if (missing.length > 0) return json(400, Object.fromEntries(missing.map((k) => [k, REQUIRED])));
      const userId = Number(input.user);
      if (!center.seed.users.some((u) => u.id === userId)) return json(400, { user: ["Usuario no válido."] });
      const clientId = input.cliente == null ? null : Number(input.cliente);
      if (clientId !== null && !center.clients.some((c) => c.id === clientId)) {
        return json(400, { cliente: ["Cliente no válido."] });
      }
      const status = input.estado == null ? KOIBOX_STATUS.PENDING : Number(input.estado);
      if (!STATUS_LABEL[status]) return json(400, { estado: ["Estado no válido."] });
      const services = input.servicios;
      const appointment: StoredAppointment = {
        id: center.nextId++,
        title: String(input.titulo),
        date: String(input.fecha),
        start: withSeconds(String(input.hora_inicio)),
        end: withSeconds(String(input.hora_fin)),
        userId,
        clientId,
        serviceIds: Array.isArray(services) ? services.map(Number) : services != null ? [Number(services)] : [],
        status,
        notes: typeof input.notas === "string" ? input.notas : "",
        tags: Array.isArray(input.tags) ? (input.tags as KoiboxTag[]).map((t) => ({ name: t.name })) : [],
      };
      if (toMinutes(appointment.end) <= toMinutes(appointment.start)) {
        return json(400, { hora_fin: ["Debe ser posterior al inicio."] });
      }
      if (!freesSlot(appointment.status) && (overlaps(center, appointment) || blocked(center, appointment))) {
        return json(400, { non_field_errors: ["La profesional ya tiene una cita a esa hora."] });
      }
      center.appointments.push(appointment);
      return json(201, toKoibox(center, appointment));
    }

    if (method === "GET" && path === "/agenda/") {
      const from = url.searchParams.get("fecha__gte")?.slice(0, 10);
      const to = url.searchParams.get("fecha__lte")?.slice(0, 10);
      const userIds = list(url.searchParams.get("user__id__in")).map(Number);
      const statuses = list(url.searchParams.get("estado__id__in")).map(Number);
      const items = center.appointments
        .filter(
          (a) =>
            (!from || a.date >= from) &&
            (!to || a.date <= to) &&
            (userIds.length === 0 || userIds.includes(a.userId)) &&
            (statuses.length === 0 || statuses.includes(a.status)),
        )
        .sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`) || a.id - b.id)
        .map((a) => toKoibox(center, a));
      return page(url, items);
    }

    const one = /^\/agenda\/(\d+)\/$/.exec(path);
    if (one) {
      const appointment = center.appointments.find((a) => a.id === Number(one[1]));
      if (!appointment) return json(404, { detail: "No encontrado." });
      if (method === "GET") return json(200, toKoibox(center, appointment));
      if (method === "PATCH") {
        const patch = (body ?? {}) as { estado?: number; notas?: string; tags?: KoiboxTag[] };
        const nextStatus = patch.estado;
        if (nextStatus !== undefined && !STATUS_LABEL[nextStatus]) return json(400, { estado: ["Estado no válido."] });
        // Reactivar una cita anulada no puede pisar otra
        if (
          nextStatus !== undefined &&
          freesSlot(appointment.status) &&
          !freesSlot(nextStatus) &&
          overlaps(center, appointment, appointment.id)
        ) {
          return json(400, { non_field_errors: ["La profesional ya tiene una cita a esa hora."] });
        }
        if (nextStatus !== undefined) appointment.status = nextStatus;
        if (patch.notas !== undefined) appointment.notes = patch.notas;
        if (patch.tags !== undefined) appointment.tags = patch.tags.map((t) => ({ name: t.name }));
        return json(200, toKoibox(center, appointment));
      }
    }

    return json(404, { detail: "No encontrado." });
  }

  const fakeFetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const method = (init.method ?? "GET").toUpperCase();
    log.push({ method, path: url.pathname, search: url.search });

    const key = new Headers(init.headers).get("X-Koibox-Key");
    if (!key) {
      return json(401, { detail: "Las credenciales de autenticación no se proveyeron." }, { "WWW-Authenticate": "X-Koibox-Key" });
    }
    const center = centers.get(key);
    if (!center) return json(403, { detail: "Clave no válida." });

    const t = now();
    center.calls = center.calls.filter((s) => s > t - 60_000);
    if (center.calls.length >= ratePerMinute) return json(429, { detail: "Demasiadas peticiones." }, { "Retry-After": "1" });
    center.calls.push(t);

    const failure = failures.shift();
    if (failure) return json(failure.status, failure.body ?? { detail: "Fallo simulado" }, failure.headers);

    const body = typeof init.body === "string" && init.body ? JSON.parse(init.body) : undefined;
    return handle(method, url, body, center);
  };

  return {
    fetch: fakeFetch as typeof fetch,
    // Las próximas `times` llamadas (de cualquier centro) fallan con ese estado
    failNext(status: number, times = 1, body?: unknown, headers?: Record<string, string>) {
      for (let i = 0; i < times; i++) failures.push({ status, body, headers });
    },
    // Llamadas recibidas, en orden (para comprobar qué se pidió)
    calls: log,
    // Datos de un centro, para mirarlos en los tests
    center(key: string) {
      const c = centers.get(key);
      if (!c) throw new Error(`No hay centro con la clave ${key}`);
      return { clients: c.clients, appointments: c.appointments.map((a) => toKoibox(c, a)) };
    },
  };
}

export type FakeKoibox = ReturnType<typeof createFakeKoibox>;

// "10:00" -> "10:00:00"
function withSeconds(t: string): string {
  return /^\d{2}:\d{2}$/.test(t) ? `${t}:00` : t;
}

// Horarios como los devuelve Koibox: uno "de siempre" por profesional y uno por cada semana distinta
function buildSchedules(seed: FakeSeed, centerId: number): KoiboxSchedule[] {
  const day = (range: [string, string] | null | undefined) =>
    range ? { hora_inicio: withSeconds(range[0]), hora_fin: withSeconds(range[1]) } : null;
  const row = (id: number, userId: number, week: string | null, year: string | null, byDay: (d: number) => [string, string] | null) =>
    ({
      id,
      user: userId,
      centro: centerId,
      week,
      year,
      ...Object.fromEntries(WEEKDAY_FIELDS.map((field, i) => [field, day(byDay(i + 1))])),
    }) as KoiboxSchedule;

  const usual = seed.users.map((u, i) =>
    row(i + 1, u.id, null, null, (d) =>
      (u.days ?? [1, 2, 3, 4, 5, 6]).includes(d) ? [u.from ?? "09:00", u.to ?? "20:00"] : null,
    ),
  );
  const weeks = (seed.weekOverrides ?? []).map((o, i) =>
    row(seed.users.length + i + 1, o.userId, o.week, o.year, (d) => o.days[d] ?? null),
  );
  return [...usual, ...weeks];
}

// Datos de ejemplo para KOIBOX_DRIVER=fake: dos profesionales y dos servicios por cuenta.
// Los ids son inventados; los reales se ven con db/koibox-try.ts cuando haya clave.
export function demoSeed(account: string, index: number): FakeSeed {
  const base = (index + 1) * 100;
  return {
    name: `Koibox de prueba · ${account}`,
    users: [
      { id: base + 1, name: `Profesional ${account} 1` },
      { id: base + 2, name: `Profesional ${account} 2`, from: "10:00", to: "18:00" },
    ],
    services: [
      { id: base + 11, name: "Servicio de 30 min", duration: "00:30:00", price: "25.00", userIds: [base + 1, base + 2] },
      { id: base + 12, name: "Servicio de 60 min", duration: "01:00:00", price: "45.00", userIds: [base + 1] },
    ],
  };
}
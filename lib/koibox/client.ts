// Cliente de la API de Koibox. Una instancia por clave (una clave = un centro = una cuenta).
// Solo usa fetch, sin paquetes. En desarrollo y en los tests se le pasa el fetch del
// Koibox de mentira (fake.ts), así que todo este código se prueba sin tocar el real.
// Los métodos y parámetros son nuestros (inglés); lo que viaja a Koibox va con sus
// nombres (fecha, servicios, movil__in...).
import {
  KoiboxError,
  errorCodeForStatus,
  limiterFor,
  realClock,
  retryDelayMs,
  shouldRetry,
  type Clock,
  type RateLimiter,
} from "./limits";
import { phoneVariants, splitName, splitPhone } from "./phone";
import type {
  KoiboxAppointment,
  KoiboxAppointmentInput,
  KoiboxAppointmentPatch,
  KoiboxAvailableTime,
  KoiboxClient,
  KoiboxClientInput,
  KoiboxKeyInfo,
  KoiboxPage,
  KoiboxService,
  KoiboxBlock,
  KoiboxSchedule
} from "./types";

export const KOIBOX_BASE_URL = "https://api.koibox.cloud/api";
const PAGE_SIZE = 50; // lo máximo que devuelve Koibox por página
const MAX_PAGES = 200; // tope de seguridad: 10 000 resultados

export type AvailableTimesQuery = {
  serviceIds: number[]; // ids de servicio en Koibox
  date: string; // "YYYY-MM-DD", hora local del centro
  userId?: number; // profesional en Koibox
};

export type ListAppointmentsQuery = {
  from: string; // "YYYY-MM-DD", incluida
  to: string; // "YYYY-MM-DD", incluida
  userIds?: number[];
  statuses?: number[];
};

export interface KoiboxApi {
  me(): Promise<KoiboxKeyInfo>;
  listServices(): Promise<KoiboxService[]>;
  availableTimes(q: AvailableTimesQuery): Promise<KoiboxAvailableTime[]>;
  findClientsByPhone(phones: string[]): Promise<KoiboxClient[]>;
  createClient(input: KoiboxClientInput): Promise<KoiboxClient>;
  createAppointment(input: KoiboxAppointmentInput): Promise<KoiboxAppointment>;
  getAppointment(id: number): Promise<KoiboxAppointment | null>;
  updateAppointment(id: number, patch: KoiboxAppointmentPatch): Promise<KoiboxAppointment>;
  listAppointments(q: ListAppointmentsQuery): Promise<KoiboxAppointment[]>;
  listSchedules(): Promise<KoiboxSchedule[]>;
  listBlocks(q: { to: string }): Promise<KoiboxBlock[]>;
}

export type KoiboxClientOptions = {
  apiKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  limiter?: RateLimiter;
  clock?: Clock;
  maxRetries?: number;
  timeoutMs?: number;
  random?: () => number;
};

type Query = Record<string, string | number | boolean | number[] | string[] | undefined>;

// Los filtros de lista (`__in`, servicios) van separados por comas, como en Django.
// Pendiente de confirmar con la primera clave real.
export function buildUrl(baseUrl: string, path: string, query: Query = {}): string {
  const url = new URL(`${baseUrl.replace(/\/$/, "")}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    url.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  return url.toString();
}

export function createKoiboxClient(opts: KoiboxClientOptions): KoiboxApi {
  if (!opts.apiKey) throw new Error("Falta la clave de Koibox");
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = opts.baseUrl ?? KOIBOX_BASE_URL;
  const limiter = opts.limiter ?? limiterFor(opts.apiKey);
  const clock = opts.clock ?? realClock;
  const maxRetries = opts.maxRetries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 10_000;

  async function once<T>(method: string, url: string, body?: unknown): Promise<T> {
    await limiter.acquire();
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: {
          "X-Koibox-Key": opts.apiKey,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new KoiboxError("network", `Koibox no responde (${method} ${new URL(url).pathname}): ${reason}`);
    }

    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      throw new KoiboxError(
        errorCodeForStatus(response.status),
        `Koibox respondió ${response.status} a ${method} ${new URL(url).pathname}${describeDetail(data)}`,
        { status: response.status, detail: data, retryAfter: response.headers.get("Retry-After") },
      );
    }
    return data as T;
  }

  async function request<T>(method: string, path: string, query?: Query, body?: unknown): Promise<T> {
    const url = buildUrl(baseUrl, path, query);
    for (let attempt = 0; ; attempt++) {
      try {
        return await once<T>(method, url, body);
      } catch (error) {
        if (!(error instanceof KoiboxError) || attempt >= maxRetries || !shouldRetry(error, method)) throw error;
        await clock.sleep(retryDelayMs(attempt, error.retryAfter, opts.random));
      }
    }
  }

  // Recorre todas las páginas con limit/offset (no seguimos `next`, que trae su propio host)
  async function listAll<T>(path: string, query: Query = {}): Promise<T[]> {
    const all: T[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await request<KoiboxPage<T>>("GET", path, { ...query, limit: PAGE_SIZE, offset: all.length });
      if (!data || !Array.isArray(data.results)) {
        throw new KoiboxError("invalid_response", `Respuesta sin "results" en ${path}`, { detail: data });
      }
      all.push(...data.results);
      if (data.results.length === 0 || all.length >= data.count) return all;
    }
    throw new KoiboxError("invalid_response", `Demasiadas páginas en ${path}`);
  }

  return {
    me: () => request<KoiboxKeyInfo>("GET", "/api-key/me/"),

    listServices: () => listAll<KoiboxService>("/servicios/"),

    async availableTimes({ serviceIds, date, userId }) {
      if (serviceIds.length === 0) throw new Error("Hace falta al menos un servicio");
      const data = await request<unknown>("GET", "/agenda/horas-disponibles/", {
        servicios: serviceIds,
        fecha: date,
        user: userId,
        is_solapamiento: false,
      });
      if (!Array.isArray(data)) {
        throw new KoiboxError("invalid_response", "horas-disponibles no devolvió una lista", { detail: data });
      }
      return data as KoiboxAvailableTime[];
    },

    async findClientsByPhone(phones) {
      if (phones.length === 0) return [];
      return listAll<KoiboxClient>("/clientes/", { movil__in: phones });
    },

    createClient: (input) => request<KoiboxClient>("POST", "/clientes/", undefined, input),

    async createAppointment(input) {
      const data = await request<KoiboxAppointment | KoiboxAppointment[]>("POST", "/agenda/", undefined, input);
      // Con servicios combinados Koibox devuelve varias citas; nosotros mandamos un solo servicio
      if (Array.isArray(data)) {
        if (data.length !== 1) {
          throw new KoiboxError("invalid_response", `Koibox creó ${data.length} citas en vez de una`, { detail: data });
        }
        return data[0];
      }
      return data;
    },

    async getAppointment(id) {
      try {
        return await request<KoiboxAppointment>("GET", `/agenda/${id}/`);
      } catch (error) {
        if (error instanceof KoiboxError && error.code === "not_found") return null;
        throw error;
      }
    },

    updateAppointment: (id, patch) => request<KoiboxAppointment>("PATCH", `/agenda/${id}/`, undefined, patch),

    listAppointments: ({ from, to, userIds, statuses }) =>
      listAll<KoiboxAppointment>("/agenda/", {
        fecha__gte: from,
        fecha__lte: to,
        user__id__in: userIds?.length ? userIds : undefined,
        estado__id__in: statuses?.length ? statuses : undefined,
      }),

    // Horarios de todas las profesionales (y del centro). Son pocos: una o dos páginas.
    listSchedules: () => listAll<KoiboxSchedule>("/horarios/"),

    // Bloqueos que empiezan hasta `to`. Pedimos también los antiguos porque uno que se
    // repite cada semana pudo crearse hace meses y seguir vigente.
    listBlocks: ({ to }) => listAll<KoiboxBlock>("/bloqueos/", { fecha__lte: to }),
  };
}

function describeDetail(data: unknown): string {
  if (data == null || data === "") return "";
  const text = typeof data === "string" ? data : JSON.stringify(data);
  return `: ${text.slice(0, 300)}`;
}

// Busca a la clienta en Koibox por móvil y, si no está, la crea.
// Si hay varias fichas con ese móvil, se queda con la del mismo correo o, si no, con la más antigua.
// No cambia los datos de una ficha que ya existe: esa ficha la cuida recepción.
export async function findOrCreateClient(
  api: KoiboxApi,
  person: { name: string; phone: string; email?: string | null },
  countryCode: string,
): Promise<{ client: KoiboxClient; created: boolean }> {
  const found = await api.findClientsByPhone(phoneVariants(person.phone, countryCode));
  if (found.length > 0) {
    const email = person.email?.toLowerCase();
    const sameEmail = email ? found.find((c) => c.email?.toLowerCase() === email) : undefined;
    const oldest = [...found].sort((a, b) => a.id - b.id)[0];
    return { client: sameEmail ?? oldest, created: false };
  }

  const { number, prefix } = splitPhone(person.phone, countryCode);
  const { firstName, lastName } = splitName(person.name);
  const client = await api.createClient({
    nombre: firstName,
    ...(lastName ? { apellido1: lastName } : {}),
    movil: number,
    ...(prefix ? { prefijo_tel: prefix } : {}),
    ...(person.email ? { email: person.email } : {}),
    is_agree_notificaciones_email: true,
    is_agree_notificaciones_sms: true,
    is_suscrito_newsletter: false,
    is_suscrito_encuestas: false,
  });
  return { client, created: true };
}
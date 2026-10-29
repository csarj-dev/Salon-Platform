// Límites y errores de las llamadas a Koibox.
// Koibox admite unas 60 llamadas por minuto por clave (respuesta de soporte). Nos quedamos
// un poco por debajo. El contador vive en memoria: en Vercel cada instancia lleva el suyo,
// lo que basta para el volumen de un salón; si Koibox responde 429, se espera y se reintenta.

export type KoiboxErrorCode =
  | "unauthorized" // 401: falta la clave
  | "forbidden" // 403: clave no válida o el centro no tiene plan Platinum
  | "not_found" // 404
  | "bad_request" // 400: Koibox rechaza los datos (p. ej. hueco ocupado)
  | "rate_limited" // 429
  | "server_error" // 5xx
  | "network" // sin respuesta o tiempo agotado
  | "invalid_response"; // respuesta que no entendemos

export class KoiboxError extends Error {
  readonly code: KoiboxErrorCode;
  readonly status: number | null;
  readonly retryable: boolean;
  readonly detail: unknown;
  readonly retryAfter: string | null; // cabecera Retry-After de un 429, si vino

  constructor(
    code: KoiboxErrorCode,
    message: string,
    opts: { status?: number | null; detail?: unknown; retryAfter?: string | null } = {},
  ) {
    super(message);
    this.name = "KoiboxError";
    this.code = code;
    this.status = opts.status ?? null;
    this.detail = opts.detail;
    this.retryAfter = opts.retryAfter ?? null;
    this.retryable = code === "rate_limited" || code === "server_error" || code === "network";
  }
}

export function errorCodeForStatus(status: number): KoiboxErrorCode {
  if (status === 400) return "bad_request";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "bad_request";
}

// ¿Se puede repetir la llamada sin riesgo? Un 429 significa que Koibox no la procesó,
// así que siempre. Un 5xx o un corte en un POST pudo haber creado la cita: no se repite,
// para no duplicarla (lo resuelve quien llama, mirando si existe).
export function shouldRetry(error: KoiboxError, method: string): boolean {
  if (error.code === "rate_limited") return true;
  if (!error.retryable) return false;
  return method !== "POST";
}

// Espera antes del reintento `attempt` (0, 1, 2...): lo que diga Retry-After o,
// si no, 0,5 s, 1 s, 2 s... con algo de azar, y como mucho 8 s.
export function retryDelayMs(attempt: number, retryAfter: string | null, random: () => number = Math.random): number {
  const seconds = retryAfter === null ? NaN : Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
  const base = 500 * 2 ** attempt;
  return Math.min(base + Math.floor(random() * 250), 8_000);
}

export type Clock = { now: () => number; sleep: (ms: number) => Promise<void> };

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

// Ventana deslizante: como mucho `limit` llamadas en cualquier periodo de `windowMs`
export class RateLimiter {
  private readonly stamps: number[] = [];
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly limit = 55,
    private readonly windowMs = 60_000,
    private readonly clock: Clock = realClock,
  ) {
    if (!Number.isInteger(limit) || limit <= 0) throw new Error("limit debe ser un entero positivo");
  }

  // Resuelve cuando ya se puede llamar. Las llamadas se atienden en orden de llegada.
  acquire(): Promise<void> {
    const turn = this.chain.then(() => this.waitForSlot());
    this.chain = turn.catch(() => undefined);
    return turn;
  }

  private async waitForSlot(): Promise<void> {
    for (;;) {
      const now = this.clock.now();
      while (this.stamps.length > 0 && this.stamps[0] <= now - this.windowMs) this.stamps.shift();
      if (this.stamps.length < this.limit) {
        this.stamps.push(now);
        return;
      }
      await this.clock.sleep(this.stamps[0] + this.windowMs - now);
    }
  }
}

// Un limitador por clave, compartido por todo el proceso
const limiters = new Map<string, RateLimiter>();

export function limiterFor(apiKey: string): RateLimiter {
  let limiter = limiters.get(apiKey);
  if (!limiter) {
    limiter = new RateLimiter();
    limiters.set(apiKey, limiter);
  }
  return limiter;
}
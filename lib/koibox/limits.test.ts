import { describe, expect, it } from "vitest";
import { KoiboxError, RateLimiter, errorCodeForStatus, retryDelayMs, shouldRetry, type Clock } from "./limits";

describe("errorCodeForStatus", () => {
  it("traduce los estados HTTP", () => {
    expect([400, 401, 403, 404, 429, 500, 503].map(errorCodeForStatus)).toEqual([
      "bad_request",
      "unauthorized",
      "forbidden",
      "not_found",
      "rate_limited",
      "server_error",
      "server_error",
    ]);
  });
});

describe("shouldRetry", () => {
  const e = (code: ConstructorParameters<typeof KoiboxError>[0]) => new KoiboxError(code, "x");

  it("un 429 se repite siempre, también en POST", () => {
    expect(shouldRetry(e("rate_limited"), "POST")).toBe(true);
  });

  it("5xx y cortes se repiten en lecturas y PATCH, nunca en POST", () => {
    expect(shouldRetry(e("server_error"), "GET")).toBe(true);
    expect(shouldRetry(e("network"), "PATCH")).toBe(true);
    expect(shouldRetry(e("server_error"), "POST")).toBe(false);
    expect(shouldRetry(e("network"), "POST")).toBe(false);
  });

  it("los errores de datos o de clave no se repiten", () => {
    for (const code of ["bad_request", "unauthorized", "forbidden", "not_found"] as const) {
      expect(shouldRetry(e(code), "GET")).toBe(false);
    }
  });
});

describe("retryDelayMs", () => {
  it("respeta Retry-After (en segundos), como mucho 30 s", () => {
    expect(retryDelayMs(0, "3")).toBe(3000);
    expect(retryDelayMs(0, "120")).toBe(30_000);
  });

  it("sin Retry-After dobla la espera y no pasa de 8 s", () => {
    const none = () => 0;
    expect([0, 1, 2, 3, 4, 5].map((a) => retryDelayMs(a, null, none))).toEqual([500, 1000, 2000, 4000, 8000, 8000]);
  });
});

describe("RateLimiter", () => {
  function clock() {
    let t = 0;
    const c: Clock = { now: () => t, sleep: async (ms) => void (t += ms) };
    return { c, at: () => t };
  }

  it("deja pasar `limit` llamadas y la siguiente espera a que salga la primera de la ventana", async () => {
    const { c, at } = clock();
    const limiter = new RateLimiter(3, 60_000, c);
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    expect(at()).toBe(0);
    await limiter.acquire();
    expect(at()).toBe(60_000);
  });

  it("atiende en orden aunque se pida a la vez", async () => {
    const { c } = clock();
    const limiter = new RateLimiter(2, 1000, c);
    const order: number[] = [];
    await Promise.all([1, 2, 3, 4].map((n) => limiter.acquire().then(() => order.push(n))));
    expect(order).toEqual([1, 2, 3, 4]);
  });

  it("rechaza un límite que no tiene sentido", () => {
    expect(() => new RateLimiter(0)).toThrow();
  });
});
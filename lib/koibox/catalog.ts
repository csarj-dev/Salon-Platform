// Lo que el panel enseña de cada cuenta de Koibox: si responde, quiénes son sus usuarias y
// qué servicios tiene. Una sola llamada (sus servicios) sirve para las tres cosas.
// En la caché compartida, como el calendario (snapshot-cache.ts): abrir la página no gasta
// llamadas cada vez. Si respondió, se guarda 5 minutos; si falló, solo 1 (para volver a probar pronto).
import { cacheLife, cacheTag } from "next/cache";
import { loadSalonConfig } from "../salon-config";
import { getKoiboxClient } from "./driver";
import { KOIBOX_OWN_LIMIT, KoiboxError, RateLimiter } from "./limits";
import { durationMinutes, koiboxUsersOf } from "./match";

export type KoiboxCatalog = {
  users: { id: number; name: string }[];
  services: { id: number; name: string; minutes: number | null }[];
};

export type AccountFailure = "noKey" | "badKey" | "noResponse" | "other";

export type AccountStatus =
  | { ok: true; checkedAt: string; catalog: KoiboxCatalog }
  | { ok: false; checkedAt: string; reason: AccountFailure; message: string };

function reasonFor(error: unknown): AccountFailure {
  if (error instanceof KoiboxError) {
    if (error.code === "unauthorized" || error.code === "forbidden") return "badKey";
    if (error.code === "network" || error.code === "server_error" || error.code === "rate_limited") return "noResponse";
    return "other";
  }
  // getKoiboxClient lanza un Error normal si falta la variable con la clave
  if (error instanceof Error && error.message.startsWith("Falta ")) return "noKey";
  return "other";
}

export async function koiboxAccountStatus(account: string): Promise<AccountStatus> {
  "use cache: remote";
  cacheTag(`koibox-status-${account}`);
  const checkedAt = new Date().toISOString();
  try {
    const config = await loadSalonConfig();
    // Corto y sin reintentos: es para enseñar el estado, no para reservar.
    // Limitador propio: dentro de "use cache" no se espera a promesas de fuera (snapshot-cache.ts).
    const api = getKoiboxClient(account, config.koibox, process.env, {
      limiter: new RateLimiter(KOIBOX_OWN_LIMIT),
      timeoutMs: 5_000,
      maxRetries: 0,
    });
    const services = (await api.listServices()).filter((s) => s.is_active !== false);
    cacheLife({ stale: 60, revalidate: 300, expire: 900 });
    return {
      ok: true,
      checkedAt,
      catalog: {
        users: koiboxUsersOf(account, services).map((u) => ({ id: u.id, name: u.name })),
        services: services
          .map((s) => ({ id: s.id, name: s.nombre, minutes: durationMinutes(s.duracion) }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      },
    };
  } catch (error) {
    // Un fallo se recuerda solo un minuto
    cacheLife({ stale: 30, revalidate: 60, expire: 120 });
    console.error(`[koibox] estado de la cuenta ${account}`, error);
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, checkedAt, reason: reasonFor(error), message: message.slice(0, 200) };
  }
}
// Datos de Koibox de una cuenta, guardados en caché unos minutos y compartidos entre visitas.
// Koibox admite unas 60 llamadas por minuto por clave: sin caché, cada visita al calendario
// gastaría varias. Con caché, como mucho se descargan de nuevo cada 2 minutos por cuenta.
// "use cache: remote" = caché compartida entre todas las instancias de Vercel
// (guía: node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-cache-remote.md).
import { cacheLife, cacheTag } from "next/cache";
import { loadSalonConfig } from "../salon-config";
import { getKoiboxClient } from "./driver";
import { loadKoiboxSnapshot } from "./snapshot";
import type { KoiboxSnapshot } from "./schedule";

export async function cachedKoiboxSnapshot(account: string, from: string, to: string): Promise<KoiboxSnapshot> {
  "use cache: remote";
  // stale: lo que el navegador lo da por bueno; revalidate: cada cuánto se renueva; expire: tope
  cacheLife({ stale: 60, revalidate: 120, expire: 300 });
  cacheTag(`koibox-snapshot-${account}`);
  const config = await loadSalonConfig();
  return loadKoiboxSnapshot(getKoiboxClient(account, config.koibox), from, to);
}

// Sin caché: para confirmar una hora justo antes de enseñar el formulario o de reservar
export async function freshKoiboxSnapshot(account: string, from: string, to: string): Promise<KoiboxSnapshot> {
  const config = await loadSalonConfig();
  return loadKoiboxSnapshot(getKoiboxClient(account, config.koibox), from, to);
}
import type { AgendaKoibox } from "./agenda-db";
import type { KoiboxSnapshot } from "./koibox/schedule";
import { cachedKoiboxSnapshot } from "./koibox/snapshot-cache";
import type { SalonConfig } from "./salon-config";

/**
 * Modo Koibox: la foto de cada cuenta para una semana (lunes a domingo), de la misma caché que
 * usa la web. Moverse entre días de esa semana no llama a Koibox (60 peticiones por minuto por
 * IP, para todas las cuentas juntas). Si una cuenta no responde, sus profesionales usan nuestro
 * horario y `down` lo avisa.
 */
export async function loadAgendaKoibox(
  config: SalonConfig,
  week: { from: string; to: string },
): Promise<{ enabled: boolean; koibox?: AgendaKoibox; down: boolean }> {
  if (config.booking.availability !== "koibox") return { enabled: false, down: false };

  const accounts = Object.keys(config.koibox.accounts);
  const results = await Promise.allSettled(accounts.map((a) => cachedKoiboxSnapshot(a, week.from, week.to)));
  const snapshots: Record<string, KoiboxSnapshot> = {};
  let down = false;
  results.forEach((r, i) => {
    if (r.status === "fulfilled") snapshots[accounts[i]] = r.value;
    else {
      down = true;
      console.error("[agenda] Koibox no respondió:", accounts[i], r.reason);
    }
  });
  return { enabled: true, koibox: { accounts: config.koibox.accounts, snapshots }, down };
}
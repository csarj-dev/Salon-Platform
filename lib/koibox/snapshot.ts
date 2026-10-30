// Descarga de una cuenta de Koibox lo necesario para calcular huecos entre dos fechas:
// horarios, citas que ocupan hueco y bloqueos. Son 3 lecturas (más páginas si hay muchas citas).
// Devuelve datos planos para poder guardarlos en caché (ver snapshot-cache.ts).
import type { KoiboxApi } from "./client";
import type { KoiboxSnapshot } from "./schedule";
import { freesSlot } from "./statuses";
import { refId } from "./types";

export async function loadKoiboxSnapshot(api: KoiboxApi, from: string, to: string): Promise<KoiboxSnapshot> {
  const [schedules, appointments, blocks] = await Promise.all([
    api.listSchedules(),
    api.listAppointments({ from, to }),
    api.listBlocks({ to }),
  ]);

  return {
    schedules,
    appointments: appointments.flatMap((a) => {
      const userId = refId(a.user);
      // Las anuladas o eliminadas no ocupan; sin hora de fin no sabemos cuánto ocupa
      if (userId === null || !a.hora_fin || freesSlot(refId(a.estado ?? null))) return [];
      return [{ userId, date: a.fecha, start: a.hora_inicio, end: a.hora_fin }];
    }),
    // Los bloqueos que no se repiten y son de antes del rango ya no afectan
    blocks: blocks
      .map((b) => ({
        userId: b.user,
        date: b.fecha,
        start: b.hora_inicio,
        end: b.hora_fin,
        recurrence: b.recurrencia || "none",
      }))
      .filter((b) => b.recurrence !== "none" || b.date >= from),
  };
}
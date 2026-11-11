// Huecos de un servicio entre dos fechas, calculados con los datos de Koibox.
// Mismo resultado y mismas funciones que el modo local (lib/availability-range.ts);
// solo cambia de dónde salen turnos y ocupaciones. Lógica pura: sin base de datos ni red.
import { DateTime } from "luxon";
import { getAvailableSlots } from "../availability";
import type { AvailabilityOptions } from "../availability-db";
import type { ServiceAvailability } from "../availability-service";
import { mergeSlots, type StaffSlots } from "../merge-slots";
import { dayRange } from "../working-hours";
import { busyOn, workingHoursOn, type KoiboxSnapshot } from "./schedule";

const DAY_FORMAT = "yyyy-MM-dd";

// Una profesional del equipo ya enlazada con Koibox
export type KoiboxTeamMember = {
  staffId: number;
  staffName: string;
  account: string;
  koiboxUserId: number;
  koiboxServiceId: number;
};

export type KoiboxAvailabilityInput = {
  team: KoiboxTeamMember[];
  snapshots: Record<string, KoiboxSnapshot>; // uno por cuenta
  // Citas que están en nuestra base y quizá aún no en Koibox (p. ej. una reserva web en curso)
  localBusy: { staffId: number; start: Date; end: Date }[];
  durationMin: number;
  from: string; // "YYYY-MM-DD", incluido
  to: string; // incluido
  opts: AvailabilityOptions;
  now: Date;
  // Al cambiar una cita de hora: su propio hueco no cuenta como ocupado. En Koibox sale como
  // una cita más, sin nuestro id: se reconoce por profesional, día y hora exactos.
  ignore?: { staffId: number; start: Date; end: Date };
};

// Mapa "2026-11-02" -> huecos de ese día. Los días sin ningún hueco no aparecen.
export function computeKoiboxAvailability(input: KoiboxAvailabilityInput): Map<string, ServiceAvailability> {
  const result = new Map<string, ServiceAvailability>();
  const { opts } = input;
  if (input.to < input.from || input.team.length === 0) return result;

  let day = DateTime.fromISO(input.from, { zone: opts.zone });
  for (let iso = day.toFormat(DAY_FORMAT); iso <= input.to; iso = day.toFormat(DAY_FORMAT)) {
    const bounds = dayRange(iso, opts.zone);
    const perStaff: StaffSlots[] = [];

    for (const member of input.team) {
      const snapshot = input.snapshots[member.account];
      if (!snapshot) continue;
      const local = input.localBusy.filter(
        (b) =>
          b.staffId === member.staffId &&
          b.start.getTime() < bounds.end.getTime() &&
          b.end.getTime() > bounds.start.getTime(),
      );
      const fromKoibox = busyOn(snapshot, member.koiboxUserId, iso, opts.zone);
      const ignore = input.ignore;
      const own =
        ignore && ignore.staffId === member.staffId
          ? fromKoibox.findIndex(
              (b) => b.start.getTime() === ignore.start.getTime() && b.end.getTime() === ignore.end.getTime(),
            )
          : -1;
      const slots = getAvailableSlots({
        workingHours: workingHoursOn(snapshot, member.koiboxUserId, iso, opts.zone),
        busy: [...(own === -1 ? fromKoibox : fromKoibox.filter((_, i) => i !== own)), ...local],
        durationMin: input.durationMin,
        stepMin: opts.stepMin,
        bufferMin: opts.bufferMin,
        now: input.now,
        minNoticeHours: opts.minNoticeHours,
      });
      if (slots.length > 0) perStaff.push({ staffId: member.staffId, staffName: member.staffName, slots });
    }

    if (perStaff.length > 0) result.set(iso, { perStaff, any: mergeSlots(perStaff) });
    day = day.plus({ days: 1 });
  }
  return result;
}
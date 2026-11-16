import { asc, and, eq, gt, lt } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "../db";
import { location, schedule, staff, timeOff } from "../db/schema";
import type { Interval } from "./availability";
import { blockOccursOn, busyOn, workingHoursOn, type KoiboxSnapshot } from "./koibox/schedule";
import type { KoiboxConfig } from "./salon-config";
import { localToInstant } from "./timezone";
import { buildWorkingHours, dayRange } from "./working-hours";

/** Turno de un día. En modo Koibox el local puede no saberse (null): Koibox no lo dice. */
export type AgendaShift = Interval & { locationId: number | null; locationName: string | null };

export type AgendaColumn = {
  staffId: number;
  staffName: string;
  /** Turnos de ese día (en el local elegido, si hay filtro), en orden */
  shifts: AgendaShift[];
  /** Ausencias de nuestra base ese día, recortadas al día */
  timeOff: Interval[];
  /** Bloqueos de Koibox ese día (descansos, ausencias apuntadas allí) */
  blocks: Interval[];
  /** Tiene turno ese día */
  working: boolean;
  /** De dónde salen sus turnos: los mismos que usa la web para dar huecos */
  source: "local" | "koibox";
  /** Modo Koibox y sin enlazar: la web no le da huecos */
  unlinked: boolean;
  /** Su cuenta de Koibox (el punto de color junto a su nombre). null = sin enlazar */
  koiboxAccount: string | null;
  /** Modo Koibox: lo que tiene ocupado en Koibox ese día (citas, también las creadas allí) */
  koiboxBusy: Interval[];
};

/** Modo Koibox: los datos de cada cuenta para ese día (sin una cuenta, sus profesionales usan nuestro horario). */
export type AgendaKoibox = {
  accounts: KoiboxConfig["accounts"];
  snapshots: Record<string, KoiboxSnapshot>;
};

/**
 * Las columnas de la agenda de un día, una por profesional, con sus turnos, ausencias y bloqueos.
 * Los turnos salen de donde los saca la reserva web: de nuestra base en modo local, de Koibox
 * en modo Koibox (si no, la agenda y la web no coinciden).
 * Salen las que trabajan ese día; con `all`, también las demás (del local elegido, o todas).
 * Las de `withAppointments` salen siempre: una cita nunca se queda sin columna.
 */
export async function loadAgendaColumns(opts: {
  date: string; // "2026-11-16", día en la zona del salón
  zone: string;
  locationId?: number;
  all?: boolean;
  withAppointments?: number[];
  koibox?: AgendaKoibox;
}): Promise<AgendaColumn[]> {
  const day = dayRange(opts.date, opts.zone);
  const weekday = DateTime.fromISO(opts.date, { zone: opts.zone }).weekday; // 1 = lunes
  const extra = new Set(opts.withAppointments ?? []);

  const [team, rows, absences, locations] = await Promise.all([
    db
      .select({
        id: staff.id,
        name: staff.name,
        active: staff.active,
        koiboxAccount: staff.koiboxAccount,
        koiboxUserId: staff.koiboxUserId,
      })
      .from(staff)
      .orderBy(asc(staff.name)),
    // Todos los días de la semana: con `all` hace falta saber quién es de ese local
    db
      .select({
        staffId: schedule.staffId,
        locationId: schedule.locationId,
        locationName: location.name,
        weekday: schedule.weekday,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
      })
      .from(schedule)
      .innerJoin(location, eq(location.id, schedule.locationId))
      .where(opts.locationId ? eq(schedule.locationId, opts.locationId) : undefined),
    db
      .select({ staffId: timeOff.staffId, start: timeOff.startsAt, end: timeOff.endsAt })
      .from(timeOff)
      .where(and(lt(timeOff.startsAt, day.end), gt(timeOff.endsAt, day.start))),
    // Para saber en qué locales trabaja cada cuenta de Koibox (el config los da por slug)
    opts.koibox
      ? db.select({ id: location.id, name: location.name, slug: location.slug }).from(location)
      : Promise.resolve([]),
  ]);

  const toInstants = (x: { start: string; end: string }): Interval => ({
    start: localToInstant(opts.date, x.start, opts.zone),
    end: localToInstant(opts.date, x.end, opts.zone),
  });

  const columns: AgendaColumn[] = [];
  for (const s of team) {
    const mine = rows.filter((r) => r.staffId === s.id);
    const linked = s.koiboxAccount !== null && s.koiboxUserId !== null;
    const snapshot = opts.koibox && linked ? opts.koibox.snapshots[s.koiboxAccount!] : undefined;

    let shifts: AgendaShift[];
    let blocks: Interval[] = [];
    let koiboxBusy: Interval[] = [];
    let belongsHere: boolean;

    if (snapshot) {
      // ---- Modo Koibox: turnos y bloqueos de su usuaria en su cuenta ----
      const slugs = opts.koibox!.accounts[s.koiboxAccount!]?.locations;
      const accountLocations = slugs ? locations.filter((l) => l.slug !== null && slugs.includes(l.slug)) : null;
      belongsHere = !opts.locationId || accountLocations === null || accountLocations.some((l) => l.id === opts.locationId);
      // Si la cuenta trabaja en un solo local, ese es el local del turno
      const only = accountLocations?.length === 1 ? accountLocations[0] : null;
      shifts = belongsHere
        ? workingHoursOn(snapshot, s.koiboxUserId!, opts.date, opts.zone).map((interval) => ({
            ...interval,
            locationId: only?.id ?? null,
            locationName: only?.name ?? null,
          }))
        : [];
      blocks = belongsHere
        ? snapshot.blocks
            .filter((b) => b.userId === s.koiboxUserId && b.start < b.end && blockOccursOn(b, opts.date))
            .map(toInstants)
        : [];
      // Solo citas: los bloqueos ya van aparte (busyOn junta las dos cosas)
      koiboxBusy = belongsHere
        ? subtractBlocks(busyOn(snapshot, s.koiboxUserId!, opts.date, opts.zone), blocks)
        : [];
    } else {
      // ---- Modo local (o Koibox sin datos de esa cuenta): nuestro horario ----
      belongsHere = opts.locationId ? mine.length > 0 : true;
      shifts = mine
        .filter((r) => r.weekday === weekday)
        .flatMap((r) =>
          buildWorkingHours(opts.date, opts.zone, [r]).map((interval) => ({
            ...interval,
            locationId: r.locationId,
            locationName: r.locationName,
          })),
        );
    }
    shifts.sort((a, b) => a.start.getTime() - b.start.getTime());

    const working = s.active && shifts.length > 0;
    const belongs = s.active && belongsHere;
    if (!working && !extra.has(s.id) && !(opts.all && belongs)) continue;

    columns.push({
      staffId: s.id,
      staffName: s.name,
      shifts: s.active ? shifts : [],
      timeOff: absences
        .filter((a) => a.staffId === s.id)
        .map((a) => ({
          start: new Date(Math.max(a.start.getTime(), day.start.getTime())),
          end: new Date(Math.min(a.end.getTime(), day.end.getTime())),
        })),
      blocks: s.active ? blocks : [],
      working,
      source: snapshot ? "koibox" : "local",
      unlinked: Boolean(opts.koibox) && !linked,
      koiboxAccount: linked ? s.koiboxAccount : null,
      koiboxBusy: s.active ? koiboxBusy : [],
    });
  }
  return columns;
}

// busyOn devuelve citas y bloqueos juntos: se quitan los que coinciden exactamente con un bloqueo
function subtractBlocks(busy: Interval[], blocks: Interval[]): Interval[] {
  return busy.filter(
    (b) => !blocks.some((k) => k.start.getTime() === b.start.getTime() && k.end.getTime() === b.end.getTime()),
  );
}

export type AgendaWeekRow = {
  staffId: number;
  staffName: string;
  koiboxAccount: string | null;
  unlinked: boolean;
  /** Una por día de la semana (mismo orden que `dates`); null = ese día no es de este local */
  days: (AgendaColumn | null)[];
};

export type AgendaWeek = { dates: string[]; rows: AgendaWeekRow[] };

/**
 * La semana de la agenda: una fila por profesional, una casilla por día.
 * Salen las que trabajan algún día de la semana; con `all`, también las demás;
 * las de `withAppointments` siempre. Mismos turnos que la vista de día (y que la web).
 */
export async function loadAgendaWeek(opts: {
  from: string; // lunes, "2026-11-16"
  to: string; // domingo
  zone: string;
  locationId?: number;
  all?: boolean;
  withAppointments?: number[];
  koibox?: AgendaKoibox;
}): Promise<AgendaWeek> {
  const dates: string[] = [];
  for (let d = DateTime.fromISO(opts.from); d.toISODate()! <= opts.to; d = d.plus({ days: 1 })) {
    dates.push(d.toISODate()!);
  }

  // Cada día con `all`: así cada fila tiene todas sus casillas, trabaje o no ese día
  const perDay = await Promise.all(
    dates.map((date) =>
      loadAgendaColumns({
        date,
        zone: opts.zone,
        locationId: opts.locationId,
        all: true,
        withAppointments: opts.withAppointments,
        koibox: opts.koibox,
      }),
    ),
  );

  const rows = new Map<number, AgendaWeekRow>();
  perDay.forEach((columns, i) => {
    for (const c of columns) {
      let row = rows.get(c.staffId);
      if (!row) {
        row = {
          staffId: c.staffId,
          staffName: c.staffName,
          koiboxAccount: c.koiboxAccount,
          unlinked: c.unlinked,
          days: dates.map(() => null),
        };
        rows.set(c.staffId, row);
      }
      row.days[i] = c;
    }
  });

  const extra = new Set(opts.withAppointments ?? []);
  return {
    dates,
    rows: [...rows.values()]
      .filter((r) => opts.all || extra.has(r.staffId) || r.days.some((d) => d?.working))
      .sort((a, b) => a.staffName.localeCompare(b.staffName)),
  };
}
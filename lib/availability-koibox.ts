// Huecos de la reserva web cuando el salón trabaja con Koibox (booking.availability = "koibox").
// Une nuestra base (qué profesionales hacen el servicio en este local y con qué ids de Koibox)
// con los datos de Koibox (horarios, citas y bloqueos) y calcula con las funciones de siempre.
import { and, asc, eq, gt, inArray, lt, ne, notInArray, or } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "../db";
import { appointment, koiboxServiceMap, location, locationService, service, staff, staffService } from "../db/schema";
import type { AvailabilityOptions } from "./availability-db";
import type { ServiceAvailability } from "./availability-service";
import { computeKoiboxAvailability, type KoiboxTeamMember } from "./koibox/availability";
import { resolveKoiboxTarget } from "./koibox/routing";
import type { KoiboxSnapshot } from "./koibox/schedule";
import type { KoiboxConfig } from "./salon-config";
import { dayRange } from "./working-hours";

const DAY_FORMAT = "yyyy-MM-dd";

// Koibox no responde o responde mal: no se puede mostrar ni confirmar ninguna hora
export class KoiboxUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`No se pudo consultar Koibox: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "KoiboxUnavailableError";
  }
}

// Cómo conseguir los datos de una cuenta: con caché (calendario) o sin ella (al confirmar)
export type SnapshotLoader = (account: string, from: string, to: string) => Promise<KoiboxSnapshot>;

// Profesionales que hacen el servicio en este local, enlazadas con Koibox, y la duración del servicio.
// null si el servicio no existe o este local no lo ofrece.
export async function loadKoiboxTeam(
  locationId: number,
  serviceId: number,
  koibox: KoiboxConfig,
): Promise<{ durationMin: number; team: KoiboxTeamMember[] } | null> {
  const [svc] = await db.select({ durationMin: service.durationMin }).from(service).where(eq(service.id, serviceId));
  if (!svc) return null;

  const [offered] = await db
    .select({ slug: location.slug })
    .from(locationService)
    .innerJoin(location, eq(location.id, locationService.locationId))
    .where(and(eq(locationService.locationId, locationId), eq(locationService.serviceId, serviceId)));
  if (!offered) return null;

  const [members, links] = await Promise.all([
    db
      .select({ id: staff.id, name: staff.name, account: staff.koiboxAccount, userId: staff.koiboxUserId })
      .from(staff)
      .innerJoin(staffService, eq(staffService.staffId, staff.id))
      .where(and(eq(staffService.serviceId, serviceId), eq(staff.active, true)))
      .orderBy(asc(staff.name)),
    db.select().from(koiboxServiceMap).where(eq(koiboxServiceMap.serviceId, serviceId)),
  ]);

  const accountIds = Object.keys(koibox.accounts);
  const team: KoiboxTeamMember[] = [];
  for (const m of members) {
    const routed = resolveKoiboxTarget(
      { staffId: m.id, staffName: m.name, koiboxAccount: m.account, koiboxUserId: m.userId },
      serviceId,
      links,
      accountIds,
    );
    if (!routed.ok) {
      // Sin enlazar no se le pueden pedir horas a Koibox: no sale en la web hasta que se enlace
      console.warn(`[koibox] ${routed.message}`);
      continue;
    }
    // La cuenta solo trabaja en sus locales (si el config los indica)
    const where = koibox.accounts[routed.target.account].locations;
    if (where && (!offered.slug || !where.includes(offered.slug))) continue;

    team.push({
      staffId: m.id,
      staffName: m.name,
      account: routed.target.account,
      koiboxUserId: routed.target.koiboxUserId,
      koiboxServiceId: routed.target.koiboxServiceId,
    });
  }
  return { durationMin: svc.durationMin, team };
}

// Citas de nuestra base que ocupan hueco (las de la web pueden no estar aún en Koibox).
// Mismo criterio que el modo local: canceladas y caducadas no ocupan; una pendiente de
// depósito, solo hasta que vence su plazo.
async function localBusy(staffIds: number[], from: string, to: string, zone: string, now: Date) {
  if (staffIds.length === 0) return [];
  const start = dayRange(from, zone).start;
  const end = dayRange(to, zone).end;
  return db
    .select({ staffId: appointment.staffId, start: appointment.startsAt, end: appointment.endsAt })
    .from(appointment)
    .where(
      and(
        inArray(appointment.staffId, staffIds),
        notInArray(appointment.status, ["cancelled", "expired"]),
        or(ne(appointment.status, "pending_deposit"), gt(appointment.depositDueAt, now)),
        lt(appointment.startsAt, end),
        gt(appointment.endsAt, start),
      ),
    );
}

async function snapshotsFor(team: KoiboxTeamMember[], from: string, to: string, load: SnapshotLoader) {
  const accounts = [...new Set(team.map((m) => m.account))];
  try {
    const loaded = await Promise.all(accounts.map((a) => load(a, from, to)));
    return Object.fromEntries(accounts.map((a, i) => [a, loaded[i]]));
  } catch (error) {
    throw new KoiboxUnavailableError(error);
  }
}

// Huecos de todos los días entre dos fechas (el calendario y las horas de cada día).
// Llamadas a Koibox: las de `load` por cada cuenta implicada, nada más.
export async function getKoiboxAvailabilityForRange(
  locationId: number,
  serviceId: number,
  from: string,
  to: string,
  opts: AvailabilityOptions,
  now: Date,
  koibox: KoiboxConfig,
  load: SnapshotLoader,
): Promise<Map<string, ServiceAvailability>> {
  const info = await loadKoiboxTeam(locationId, serviceId, koibox);
  if (!info || info.team.length === 0 || to < from) return new Map();

  const [snapshots, busy] = await Promise.all([
    snapshotsFor(info.team, from, to, load),
    localBusy(info.team.map((m) => m.staffId), from, to, opts.zone, now),
  ]);

  return computeKoiboxAvailability({
    team: info.team,
    snapshots,
    localBusy: busy,
    durationMin: info.durationMin,
    from,
    to,
    opts,
    now,
  });
}

// Comprueba con datos frescos de Koibox (sin caché) que la hora sigue libre.
// Devuelve la profesional que la atiende (la elegida, o la primera libre si fue "cualquiera"),
// o null si ya no está libre. Si Koibox no responde, lanza KoiboxUnavailableError.
export async function confirmKoiboxSlot(
  locationId: number,
  serviceId: number,
  staffChoice: number | "any",
  at: Date,
  opts: AvailabilityOptions,
  now: Date,
  koibox: KoiboxConfig,
  loadFresh: SnapshotLoader,
): Promise<number | null> {
  const info = await loadKoiboxTeam(locationId, serviceId, koibox);
  if (!info) return null;
  const team = staffChoice === "any" ? info.team : info.team.filter((m) => m.staffId === staffChoice);
  if (team.length === 0) return null;

  const date = DateTime.fromJSDate(at, { zone: opts.zone }).toFormat(DAY_FORMAT);
  const [snapshots, busy] = await Promise.all([
    snapshotsFor(team, date, date, loadFresh),
    localBusy(team.map((m) => m.staffId), date, date, opts.zone, now),
  ]);

  const day = computeKoiboxAvailability({
    team,
    snapshots,
    localBusy: busy,
    durationMin: info.durationMin,
    from: date,
    to: date,
    opts,
    now,
  }).get(date);
  const slot = day?.any.find((s) => s.startsAt.getTime() === at.getTime());
  return slot ? slot.staffIds[0] : null;
}
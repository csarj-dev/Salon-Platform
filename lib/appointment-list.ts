import { and, asc, desc, eq, gte, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db";
import { appointment, client, location, service, staff, user } from "../db/schema";

export type AppointmentStatus = typeof appointment.$inferSelect.status;

export type AppointmentListRow = {
  id: number;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  source: "web" | "phone" | "whatsapp";
  clientId: number;
  clientName: string;
  clientPhone: string;
  clientEmail: string | null;
  // La clienta tiene email (si no, no se le pueden mandar correos)
  hasEmail: boolean;
  serviceName: string;
  locationName: string;
  staffName: string;
  depositCents: number | null;
  depositDueAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  // Quién del equipo canceló / validó el depósito (null si no consta)
  cancelledByName: string | null;
  validatedByName: string | null;
  // Copia en Koibox (para el estado que se enseña en la tarjeta)
  koiboxAccount: string | null;
  koiboxAppointmentId: number | null;
  koiboxError: string | null;
  koiboxSyncedAt: Date | null;
  cancelledBy: string | null;
  depositPaidAt: Date | null;
  koiboxPreviousId: number | null;
  rescheduledAt: Date | null;
};

export type ListAppointmentsOptions = {
  /** Inclusive */
  from?: Date;
  /** Exclusive */
  to?: Date;
  statuses: AppointmentStatus[];
  order: "asc" | "desc";
  limit?: number;
  /** Nombre o teléfono de la clienta, o nº de cita ("57" o "#57") */
  search?: string;
  staffId?: number;
  locationId?: number;
  /** Todas las citas de una clienta */
  clientId?: number;
};

// Sin tildes y en minúsculas, igual en la base de datos que aquí: «lucia» encuentra «Lucía»
const WITH_ACCENTS = "áàâäéèêëíìîïóòôöúùûüñç";
const WITHOUT_ACCENTS = "aaaaeeeeiiiioooouuuunc";

export function plainText(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

// % y _ se buscan tal cual (en LIKE serían comodines)
const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

function searchCondition(raw: string | undefined): SQL | undefined {
  const q = (raw ?? "").trim().slice(0, 100);
  if (!q) return undefined;

  const parts: SQL[] = [
    sql`translate(lower(${appointment.clientName}), ${WITH_ACCENTS}, ${WITHOUT_ACCENTS}) like ${`%${escapeLike(plainText(q))}%`}`,
  ];
  const digits = q.replace(/\D/g, "");
  // Teléfono: a partir de 3 cifras, comparando solo los números ("611 22" encuentra "611222333")
  if (digits.length >= 3) {
    parts.push(sql`regexp_replace(${client.phone}, '[^0-9]', '', 'g') like ${`%${digits}%`}`);
  }
  // Nº de cita: "57" o "#57"
  if (/^#?\d{1,9}$/.test(q)) parts.push(eq(appointment.id, Number(digits)));
  return or(...parts);
}

export async function listAppointments(
  opts: ListAppointmentsOptions,
): Promise<AppointmentListRow[]> {
  const canceller = alias(user, "canceller");
  const validator = alias(user, "validator");

  const conditions: (SQL | undefined)[] = [inArray(appointment.status, opts.statuses)];
  if (opts.from) conditions.push(gte(appointment.startsAt, opts.from));
  if (opts.to) conditions.push(lt(appointment.startsAt, opts.to));
  if (opts.staffId) conditions.push(eq(appointment.staffId, opts.staffId));
  if (opts.locationId) conditions.push(eq(appointment.locationId, opts.locationId));
  if (opts.clientId) conditions.push(eq(appointment.clientId, opts.clientId));
  conditions.push(searchCondition(opts.search));

  return db
    .select({
      id: appointment.id,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      status: appointment.status,
      source: appointment.source,
      clientId: appointment.clientId,
      clientName: appointment.clientName,
      clientPhone: client.phone,
      clientEmail: appointment.clientEmail,
      hasEmail: sql<boolean>`${appointment.clientEmail} is not null`,
      serviceName: service.name,
      locationName: location.name,
      staffName: staff.name,
      depositCents: appointment.depositCents,
      depositDueAt: appointment.depositDueAt,
      cancelledAt: appointment.cancelledAt,
      cancelReason: appointment.cancelReason,
      cancelledByName: canceller.name,
      validatedByName: validator.name,
      koiboxAccount: appointment.koiboxAccount,
      koiboxAppointmentId: appointment.koiboxAppointmentId,
      koiboxError: appointment.koiboxError,
      koiboxSyncedAt: appointment.koiboxSyncedAt,
      cancelledBy: appointment.cancelledBy,
      depositPaidAt: appointment.depositPaidAt,
      koiboxPreviousId: appointment.koiboxPreviousId,
      rescheduledAt: appointment.rescheduledAt,
    })
    .from(appointment)
    .innerJoin(client, eq(client.id, appointment.clientId))
    .innerJoin(service, eq(service.id, appointment.serviceId))
    .innerJoin(location, eq(location.id, appointment.locationId))
    .innerJoin(staff, eq(staff.id, appointment.staffId))
    .leftJoin(canceller, eq(canceller.id, appointment.cancelledBy))
    .leftJoin(validator, eq(validator.id, appointment.depositValidatedBy))
    .where(and(...conditions))
    .orderBy(opts.order === "asc" ? asc(appointment.startsAt) : desc(appointment.startsAt))
    .limit(opts.limit ?? 200);
}

// Una fecha dentro de un sql`` escrito a mano: como texto ISO. Este driver no convierte Date
// fuera de las columnas (con gte(columna, fecha) sí lo hace Drizzle).
const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;

// ---- Resumen de arriba de Citas ----

export type AppointmentSummary = {
  today: number; // citas activas hoy
  todayFirst: Date | null;
  todayLast: Date | null;
  pendingDeposits: number;
  depositsDueSoon: number; // su plazo acaba antes de `soon`
  week: number; // citas activas de hoy a `weekEnd`
};

// Las fechas las calcula la página en la zona del salón (hoy, fin de hoy, dentro de una semana)
export async function appointmentSummary(range: {
  dayStart: Date;
  dayEnd: Date;
  weekEnd: Date;
  soon: Date;
}): Promise<AppointmentSummary> {
  const isToday = sql`${appointment.startsAt} >= ${ts(range.dayStart)} and ${appointment.startsAt} < ${ts(range.dayEnd)}`;
  const isPending = sql`${appointment.status} = 'pending_deposit'`;

  const [row] = await db
    .select({
      today: sql<number>`count(*) filter (where ${isToday})`.mapWith(Number),
      todayFirst: sql<Date | null>`min(${appointment.startsAt}) filter (where ${isToday})`.mapWith(appointment.startsAt),
      todayLast: sql<Date | null>`max(${appointment.startsAt}) filter (where ${isToday})`.mapWith(appointment.startsAt),
      pendingDeposits: sql<number>`count(*) filter (where ${isPending})`.mapWith(Number),
      depositsDueSoon: sql<number>`count(*) filter (where ${isPending} and ${appointment.depositDueAt} < ${ts(range.soon)})`.mapWith(Number),
      week: sql<number>`count(*) filter (where ${appointment.startsAt} < ${ts(range.weekEnd)})`.mapWith(Number),
    })
    .from(appointment)
    .where(
      and(
        inArray(appointment.status, ["booked", "pending_deposit"]),
        gte(appointment.startsAt, range.dayStart),
      ),
    );
  return row;
}

// ---- Ficha de una clienta ("Todas las citas de Carmen") ----

export type ClientSummary = {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  total: number;
  upcoming: number;
  cancelled: number;
  noShow: number;
  firstAt: Date | null; // su primera cita
};

export async function clientSummary(clientId: number, now: Date): Promise<ClientSummary | null> {
  const [c] = await db
    .select({ id: client.id, name: client.name, phone: client.phone, email: client.email })
    .from(client)
    .where(eq(client.id, clientId));
  if (!c) return null;

  const [a] = await db
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      upcoming: sql<number>`count(*) filter (where ${appointment.status} in ('booked', 'pending_deposit') and ${appointment.startsAt} >= ${ts(now)})`.mapWith(Number),
      cancelled: sql<number>`count(*) filter (where ${appointment.status} = 'cancelled')`.mapWith(Number),
      noShow: sql<number>`count(*) filter (where ${appointment.status} = 'no_show')`.mapWith(Number),
      firstAt: sql<Date | null>`min(${appointment.startsAt})`.mapWith(appointment.startsAt),
    })
    .from(appointment)
    .where(eq(appointment.clientId, clientId));

  return { ...c, ...a };
}
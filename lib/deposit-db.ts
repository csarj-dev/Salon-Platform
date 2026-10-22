import { and, asc, desc, eq, lte } from "drizzle-orm";
import { db } from "../db";
import { appointment, client, location, service, staff } from "../db/schema";

// Marca como caducadas las citas pendientes cuyo plazo venció. Devuelve cuántas.
// Libera el hueco para siempre; la cita se conserva (con los datos de contacto)
// para que el salón pueda escribir a la clienta.
export async function expireOverdueDeposits(now: Date = new Date()): Promise<number> {
  const rows = await db
    .update(appointment)
    .set({ status: "expired" })
    .where(and(eq(appointment.status, "pending_deposit"), lte(appointment.depositDueAt, now)))
    .returning({ id: appointment.id });
  return rows.length;
}

export type MarkPaidResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_pending" | "expired" };

// El salón confirma que recibió el depósito: la cita pasa a confirmada.
// Si el plazo venció pero nadie había liberado aún el hueco, se acepta igualmente.
// Si ya está caducada, no: el hueco pudo darse a otra persona y lo decide el salón a mano.
export async function markDepositPaid(
  appointmentId: number,
  now: Date = new Date(),
): Promise<MarkPaidResult> {
  const [appt] = await db
    .select({ status: appointment.status })
    .from(appointment)
    .where(eq(appointment.id, appointmentId));
  if (!appt) return { ok: false, reason: "not_found" };
  if (appt.status === "expired") return { ok: false, reason: "expired" };
  if (appt.status !== "pending_deposit") return { ok: false, reason: "not_pending" };

  // La condición sobre el estado evita pasar dos veces si hay dos peticiones a la vez
  const updated = await db
    .update(appointment)
    .set({ status: "booked", depositPaidAt: now })
    .where(and(eq(appointment.id, appointmentId), eq(appointment.status, "pending_deposit")))
    .returning({ id: appointment.id });
  if (updated.length === 0) return { ok: false, reason: "not_pending" };
  return { ok: true };
}

export type DepositRow = {
  id: number;
  status: "pending_deposit" | "expired";
  startsAt: Date;
  depositCents: number;
  depositDueAt: Date;
  clientName: string;
  clientPhone: string;
  serviceName: string;
  locationName: string;
  staffName: string;
};

// Citas esperando depósito (o, con `expired`, las que caducaron) para que el salón las gestione
export async function listDeposits(
  which: "pending_deposit" | "expired",
): Promise<DepositRow[]> {
  const rows = await db
    .select({
      id: appointment.id,
      startsAt: appointment.startsAt,
      depositCents: appointment.depositCents,
      depositDueAt: appointment.depositDueAt,
      clientName: client.name,
      clientPhone: client.phone,
      serviceName: service.name,
      locationName: location.name,
      staffName: staff.name,
    })
    .from(appointment)
    .innerJoin(client, eq(client.id, appointment.clientId))
    .innerJoin(service, eq(service.id, appointment.serviceId))
    .innerJoin(location, eq(location.id, appointment.locationId))
    .innerJoin(staff, eq(staff.id, appointment.staffId))
    .where(eq(appointment.status, which))
    .orderBy(which === "expired" ? desc(appointment.depositDueAt) : asc(appointment.depositDueAt));

  // Una cita llega a estos estados solo desde un depósito, así que estas dos columnas existen
  return rows.map((r) => ({
    ...r,
    status: which,
    depositCents: r.depositCents as number,
    depositDueAt: r.depositDueAt as Date,
  }));
}

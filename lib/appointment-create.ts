// Lo común a crear una cita, venga de la web (lib/booking.ts) o del panel (lib/staff-booking.ts):
// - qué servicios lleva: existen, el local los ofrece, la profesional los hace; con su precio
//   (el propio del local si lo tiene), lo que suman de duración y el depósito según la regla del salón;
// - la clienta: se reutiliza por teléfono o se crea;
// - guardar la cita con sus servicios.
// Lo que cambia según quién reserva (cómo se comprueba la hora, la duración, el depósito) lo
// decide cada uno antes de llamar aquí.
import { and, eq, inArray, lte } from "drizzle-orm";
import { db } from "../db";
import { appointment, appointmentService, client, locationService, service, staffService } from "../db/schema";
import { depositForServices } from "./deposit";

// La transacción que reciben upsertClient e insertAppointment
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ServiceLine = {
  position: number;
  serviceId: number;
  durationMin: number; // lo que dura el servicio de base
  priceCents: number; // el aplicado (el del local si tiene uno propio)
};

export type ResolvedServices =
  | {
      ok: true;
      lines: ServiceLine[]; // en el orden en que se hacen
      priceCents: number; // la suma
      durationMin: number; // la suma (recepción puede ajustarla)
      depositCents: number | null; // uno por categoría (depositForServices); null = no se pide
    }
  | { ok: false; reason: "unknown_service" }
  | { ok: false; reason: "service_not_offered" | "service_not_done"; serviceNames: string[] };

export async function resolveServices(q: {
  locationId: number;
  staffId: number;
  serviceIds: number[];
}): Promise<ResolvedServices> {
  if (q.serviceIds.length === 0) return { ok: false, reason: "unknown_service" };

  const [found, offered, done] = await Promise.all([
    db
      .select({
        id: service.id,
        name: service.name,
        durationMin: service.durationMin,
        priceCents: service.priceCents,
        depositCents: service.depositCents,
        categoryId: service.categoryId,
      })
      .from(service)
      .where(inArray(service.id, q.serviceIds)),
    db
      .select({ serviceId: locationService.serviceId, priceCents: locationService.priceCents })
      .from(locationService)
      .where(and(eq(locationService.locationId, q.locationId), inArray(locationService.serviceId, q.serviceIds))),
    db
      .select({ serviceId: staffService.serviceId })
      .from(staffService)
      .where(and(eq(staffService.staffId, q.staffId), inArray(staffService.serviceId, q.serviceIds))),
  ]);
  if (found.length !== new Set(q.serviceIds).size) return { ok: false, reason: "unknown_service" };
  const services = q.serviceIds.map((id) => found.find((s) => s.id === id)!);

  const notOffered = services.filter((s) => !offered.some((o) => o.serviceId === s.id));
  if (notOffered.length > 0) {
    return { ok: false, reason: "service_not_offered", serviceNames: notOffered.map((s) => s.name) };
  }
  const notDone = services.filter((s) => !done.some((d) => d.serviceId === s.id));
  if (notDone.length > 0) {
    return { ok: false, reason: "service_not_done", serviceNames: notDone.map((s) => s.name) };
  }

  const lines = services.map((s, position) => ({
    position,
    serviceId: s.id,
    durationMin: s.durationMin,
    priceCents: offered.find((o) => o.serviceId === s.id)?.priceCents ?? s.priceCents,
  }));
  return {
    ok: true,
    lines,
    priceCents: lines.reduce((sum, l) => sum + l.priceCents, 0),
    durationMin: lines.reduce((sum, l) => sum + l.durationMin, 0),
    depositCents: depositForServices(services),
  };
}

// Reutiliza la clienta por teléfono, o la crea. Devuelve el email de ESTA reserva: el que trae;
// si no trae (recepción puede no tenerlo), el que ya tenía.
// Si vuelve a reservar con otro email, se queda con el último (es donde quiere los avisos).
// `consent`: aceptó guardar sus datos (reserva web); recepción no lo recoge.
export async function upsertClient(
  tx: Tx,
  data: { name: string; phone: string; email?: string },
  opts: { now: Date; consent: boolean },
): Promise<{ clientId: number; email: string | null }> {
  const [existing] = await tx.select().from(client).where(eq(client.phone, data.phone));
  if (existing) {
    if (opts.consent && !existing.consentAt) {
      await tx.update(client).set({ consentAt: opts.now }).where(eq(client.id, existing.id));
    }
    if (data.email && data.email !== existing.email) {
      await tx.update(client).set({ email: data.email }).where(eq(client.id, existing.id));
    }
    return { clientId: existing.id, email: data.email ?? existing.email };
  }
  const [created] = await tx
    .insert(client)
    .values({
      name: data.name,
      phone: data.phone,
      email: data.email ?? null,
      consentAt: opts.consent ? opts.now : null,
    })
    .returning({ id: client.id });
  return { clientId: created.id, email: data.email ?? null };
}

// Guarda la cita y sus servicios. El servicio principal de la cita es siempre el primero.
// Antes, las pendientes cuyo plazo venció pasan a caducadas: si no, la restricción anti-solape
// de Postgres seguiría viendo su hueco ocupado.
// Si otra cita se queda el hueco un instante antes, Postgres lanza 23P01 (lo trata quien llama).
export async function insertAppointment(
  tx: Tx,
  values: Omit<typeof appointment.$inferInsert, "serviceId">,
  lines: ServiceLine[],
  now: Date,
): Promise<{ id: number; publicToken: string }> {
  await tx
    .update(appointment)
    .set({ status: "expired" })
    .where(and(eq(appointment.status, "pending_deposit"), lte(appointment.depositDueAt, now)));

  const [created] = await tx
    .insert(appointment)
    .values({ ...values, serviceId: lines[0].serviceId })
    .returning({ id: appointment.id, publicToken: appointment.publicToken });
  await tx.insert(appointmentService).values(lines.map((l) => ({ ...l, appointmentId: created.id })));
  return created;
}
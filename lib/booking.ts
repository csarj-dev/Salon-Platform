import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "../db";
import { appointment, client, locationService, service } from "../db/schema";
import { bookingInputSchema } from "./booking-schema";
import { getAvailabilityForDay, type AvailabilityOptions } from "./availability-db";
import { toAvailabilityOptions, type SalonConfig } from "./salon-config";

export type BookingOptions = AvailabilityOptions & { maxDaysAhead: number };

export function toBookingOptions(c: SalonConfig): BookingOptions {
  return { ...toAvailabilityOptions(c), maxDaysAhead: c.booking.maxDaysAhead };
}

export type BookingResult =
  | { ok: true; appointmentId: number }
  | { ok: false; reason: "invalid_input"; issues: string[] }
  | { ok: false; reason: "slot_unavailable" | "slot_taken" };

// Busca el código de error de Postgres, que según la versión de Drizzle
// puede venir en el propio error o dentro de `cause`
export function pgErrorCode(e: unknown): string | undefined {
  let cur: unknown = e;
  for (let i = 0; i < 5; i++) {
    if (typeof cur !== "object" || cur === null) return undefined;
    const c = cur as { code?: unknown; cause?: unknown };
    if (typeof c.code === "string") return c.code;
    cur = c.cause;
  }
  return undefined;
}

export async function createAppointment(
  rawInput: unknown,
  opts: BookingOptions,
  now: Date = new Date(),
): Promise<BookingResult> {
  // 1. Validar la forma de los datos
  const parsed = bookingInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid_input",
      issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }
  const input = parsed.data;

  // 2. No reservar más allá del máximo de días hacia adelante
  const latest = DateTime.fromJSDate(now, { zone: opts.zone }).plus({
    days: opts.maxDaysAhead,
  });
  if (input.startsAt.getTime() > latest.toMillis()) {
    return { ok: false, reason: "slot_unavailable" };
  }

  // 3. Comprobación previa: el hueco debe estar entre los disponibles.
  //    Cubre servicio ofrecido en el local, profesional que lo hace,
  //    turnos, bloqueos y antelación mínima. Sirve para dar un error claro.
  const date = DateTime.fromJSDate(input.startsAt, { zone: opts.zone }).toISODate();
  if (!date) return { ok: false, reason: "slot_unavailable" };

  const slots = await getAvailabilityForDay(
    input.locationId,
    input.staffId,
    input.serviceId,
    date,
    opts,
    now,
  );
  if (!slots.some((s) => s.getTime() === input.startsAt.getTime())) {
    return { ok: false, reason: "slot_unavailable" };
  }

  // 4. Transacción: cliente y cita se crean juntos o no se crea nada.
  //    La comprobación definitiva la hace la restricción anti-solape de Postgres.
  try {
    const appointmentId = await db.transaction(async (tx) => {
      const [svc] = await tx
        .select({ durationMin: service.durationMin, priceCents: service.priceCents })
        .from(service)
        .where(eq(service.id, input.serviceId));
      if (!svc) throw new Error(`Servicio ${input.serviceId} no existe`);

      // Precio propio del local si lo tiene; si no, el del servicio
      const [override] = await tx
        .select({ priceCents: locationService.priceCents })
        .from(locationService)
        .where(
          and(
            eq(locationService.locationId, input.locationId),
            eq(locationService.serviceId, input.serviceId),
          ),
        );
      const priceAppliedCents = override?.priceCents ?? svc.priceCents;

      // Reutilizar la clienta por teléfono, o crearla
      const [existing] = await tx
        .select()
        .from(client)
        .where(eq(client.phone, input.client.phone));

      let clientId: number;
      if (existing) {
        clientId = existing.id;
        if (input.consent && !existing.consentAt) {
          await tx.update(client).set({ consentAt: now }).where(eq(client.id, existing.id));
        }
      } else {
        const [created] = await tx
          .insert(client)
          .values({
            name: input.client.name,
            phone: input.client.phone,
            email: input.client.email ?? null,
            consentAt: input.consent ? now : null,
          })
          .returning({ id: client.id });
        clientId = created.id;
      }

      const endsAt = new Date(input.startsAt.getTime() + svc.durationMin * 60_000);

      const [created] = await tx
        .insert(appointment)
        .values({
          clientId,
          serviceId: input.serviceId,
          staffId: input.staffId,
          locationId: input.locationId,
          startsAt: input.startsAt,
          endsAt,
          priceAppliedCents,
          source: input.source,
        })
        .returning({ id: appointment.id });

      return created.id;
    });

    return { ok: true, appointmentId };
  } catch (e) {
    // 23P01 = exclusion_violation: otra reserva se quedó el hueco un instante antes
    if (pgErrorCode(e) === "23P01") return { ok: false, reason: "slot_taken" };
    throw e;
  }
}
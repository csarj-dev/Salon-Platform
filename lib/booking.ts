import { and, eq, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "../db";
import { appointment, client, location, locationService, service, staffService } from "../db/schema";
import { bookingInputSchema } from "./booking-schema";
import { getAvailabilityForDay, type AvailabilityOptions } from "./availability-db";
import { depositDueAt } from "./deposit";
import { toAvailabilityOptions, type AvailabilitySource, type SalonConfig } from "./salon-config";

export type BookingOptions = AvailabilityOptions & {
  maxDaysAhead: number;
  // Horas que se guarda el hueco esperando el depósito (por defecto, 24)
  depositHoldHours?: number;
  // De dónde salen los huecos (por defecto, "local"). Con "koibox" la hora ya la comprobó
  // confirmBookingSlot contra Koibox, y aquí no se miran nuestros turnos.
  availability?: AvailabilitySource;
};

export function toBookingOptions(c: SalonConfig): BookingOptions {
  return {
    ...toAvailabilityOptions(c),
    maxDaysAhead: c.booking.maxDaysAhead,
    depositHoldHours: c.booking.deposit.holdHours,
    availability: c.booking.availability,
  };
}

export type BookingResult =
  | {
      ok: true;
      appointmentId: number;
      // Enlace secreto de la página de confirmación
      publicToken: string;
      // "pending_deposit" si hay que pagar un depósito para confirmarla
      status: "booked" | "pending_deposit";
      deposit: { cents: number; dueAt: Date } | null;
    }
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

  // 2b. Lo que se reserva hablando antes, o en un local cerrado, no se reserva por la web
  if (input.source === "web") {
    const [rules] = await db
      .select({ requiresConsultation: service.requiresConsultation, active: location.active })
      .from(service)
      .innerJoin(location, eq(location.id, input.locationId))
      .where(eq(service.id, input.serviceId));
    if (!rules || rules.requiresConsultation || !rules.active) {
      return { ok: false, reason: "slot_unavailable" };
    }
  }

  // 3. Comprobación previa: el hueco debe estar entre los disponibles.
  //    Cubre servicio ofrecido en el local, profesional que lo hace,
  //    turnos, bloqueos y antelación mínima. Sirve para dar un error claro.
  if (opts.availability === "koibox") {
    // Turnos y bloqueos están en Koibox y ya se comprobaron antes de llamar aquí
    // (confirmBookingSlot). Aquí solo: el local ofrece el servicio, la profesional lo hace
    // y se respeta la antelación mínima.
    const earliest = now.getTime() + opts.minNoticeHours * 3_600_000;
    if (input.startsAt.getTime() < earliest) return { ok: false, reason: "slot_unavailable" };
    const [offered] = await db
      .select({ serviceId: locationService.serviceId })
      .from(locationService)
      .innerJoin(
        staffService,
        and(eq(staffService.serviceId, locationService.serviceId), eq(staffService.staffId, input.staffId)),
      )
      .where(and(eq(locationService.locationId, input.locationId), eq(locationService.serviceId, input.serviceId)));
    if (!offered) return { ok: false, reason: "slot_unavailable" };
  } else {
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
  }

  // 4. Transacción: cliente y cita se crean juntos o no se crea nada.
  //    La comprobación definitiva la hace la restricción anti-solape de Postgres.
  try {
    const result = await db.transaction(async (tx) => {
      const [svc] = await tx
        .select({
          durationMin: service.durationMin,
          priceCents: service.priceCents,
          depositCents: service.depositCents,
        })
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

      // Email de ESTA reserva: el del formulario; si no lo trae (p. ej. recepción), el que ya tenía
      let bookingEmail: string | null = input.client.email ?? null;
      let clientId: number;
      if (existing) {
        clientId = existing.id;
        bookingEmail ??= existing.email;
        if (input.consent && !existing.consentAt) {
          await tx.update(client).set({ consentAt: now }).where(eq(client.id, existing.id));
        }
        // Si vuelve a reservar con otro email, se queda con el último (es donde quiere el aviso)
        if (input.client.email && input.client.email !== existing.email) {
          await tx.update(client).set({ email: input.client.email }).where(eq(client.id, existing.id));
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

      // Depósito: solo en reservas hechas por la web. Recepción o WhatsApp lo gestionan a mano.
      const depositCents = input.source === "web" ? svc.depositCents : null;
      const deposit =
        depositCents === null
          ? null
          : {
              cents: depositCents,
              dueAt: depositDueAt(now, input.startsAt, opts.depositHoldHours ?? 24),
            };

      // Las pendientes cuyo plazo venció se marcan como caducadas antes de insertar:
      // si no, la restricción anti-solape de Postgres seguiría viendo su hueco ocupado
      await tx
        .update(appointment)
        .set({ status: "expired" })
        .where(
          and(eq(appointment.status, "pending_deposit"), lte(appointment.depositDueAt, now)),
        );

      const [created] = await tx
        .insert(appointment)
        .values({
          clientId,
          clientName: input.client.name,
          clientEmail: bookingEmail,
          serviceId: input.serviceId,
          staffId: input.staffId,
          locationId: input.locationId,
          startsAt: input.startsAt,
          endsAt,
          priceAppliedCents,
          source: input.source,
          locale: input.locale ?? null,
          status: deposit ? "pending_deposit" : "booked",
          depositCents: deposit?.cents ?? null,
          depositDueAt: deposit?.dueAt ?? null,
        })
        .returning({ id: appointment.id, publicToken: appointment.publicToken });

      return { created, deposit };
    });

    return {
      ok: true,
      appointmentId: result.created.id,
      publicToken: result.created.publicToken,
      status: result.deposit ? "pending_deposit" : "booked",
      deposit: result.deposit,
    };
  } catch (e) {
    // 23P01 = exclusion_violation: otra reserva se quedó el hueco un instante antes
    if (pgErrorCode(e) === "23P01") return { ok: false, reason: "slot_taken" };
    throw e;
  }
}
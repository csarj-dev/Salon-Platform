import { eq, inArray } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "../db";
import { location, service } from "../db/schema";
import { insertAppointment, resolveServices, upsertClient } from "./appointment-create";
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
  // Texto de la casilla del depósito tal y como lo vio la clienta (en su idioma y con el
  // importe). Lo pone la acción del formulario; si falta (scripts, tests) se usa uno genérico.
  depositTermsText?: (depositCents: number) => string;
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
  | { ok: false; reason: "slot_unavailable" | "slot_taken" }
  // Reserva web con depósito sin la casilla «el depósito no se devuelve»
  | { ok: false; reason: "deposit_terms" };

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
  // Los servicios, en el orden en que se hacen (con `serviceId`, uno solo, como antes)
  const serviceIds = [...new Set(input.serviceIds ?? [input.serviceId as number])];

  // 2. No reservar más allá del máximo de días hacia adelante
  const latest = DateTime.fromJSDate(now, { zone: opts.zone }).plus({
    days: opts.maxDaysAhead,
  });
  if (input.startsAt.getTime() > latest.toMillis()) {
    return { ok: false, reason: "slot_unavailable" };
  }

  if (input.source === "web") {
    const rules = await db
      .select({ requiresConsultation: service.requiresConsultation, active: location.active })
      .from(service)
      .innerJoin(location, eq(location.id, input.locationId))
      .where(inArray(service.id, serviceIds));
    if (rules.length !== serviceIds.length || rules.some((r) => r.requiresConsultation || !r.active)) {
      return { ok: false, reason: "slot_unavailable" };
    }
  }

  // 3. Los servicios: existen, el local los ofrece y la profesional los hace todos (con su precio,
  //    duración y depósito; la duración y el precio son la suma, el depósito uno por categoría)
  const resolved = await resolveServices({
    locationId: input.locationId,
    staffId: input.staffId,
    serviceIds,
  });
  if (!resolved.ok) return { ok: false, reason: "slot_unavailable" };

  // 3b. Depósito: solo en reservas hechas por la web (recepción lo elige en su propio flujo).
  //     Si lo hay, la clienta tiene que haber marcado que entiende que no se devuelve.
  const depositCents = input.source === "web" ? resolved.depositCents : null;
  if (depositCents !== null && !input.depositTermsAccepted) {
    return { ok: false, reason: "deposit_terms" };
  }

  // 4. Comprobación previa: el hueco debe estar entre los disponibles (turnos, bloqueos y
  //    antelación mínima). Sirve para dar un error claro.
  if (opts.availability === "koibox") {
    // Turnos y bloqueos están en Koibox y ya se comprobaron antes de llamar aquí
    // (confirmBookingSlot). Aquí solo la antelación mínima.
    const earliest = now.getTime() + opts.minNoticeHours * 3_600_000;
    if (input.startsAt.getTime() < earliest) return { ok: false, reason: "slot_unavailable" };
  } else {
    const date = DateTime.fromJSDate(input.startsAt, { zone: opts.zone }).toISODate();
    if (!date) return { ok: false, reason: "slot_unavailable" };

    const slots = await getAvailabilityForDay(
      input.locationId,
      input.staffId,
      serviceIds,
      date,
      opts,
      now,
    );
    if (!slots.some((s) => s.getTime() === input.startsAt.getTime())) {
      return { ok: false, reason: "slot_unavailable" };
    }
  }

  // 5. Transacción: clienta, cita y servicios se crean juntos o no se crea nada.
  //    La comprobación definitiva la hace la restricción anti-solape de Postgres.
  try {
    const result = await db.transaction(async (tx) => {
      const { clientId, email } = await upsertClient(tx, input.client, { now, consent: input.consent });

      const endsAt = new Date(input.startsAt.getTime() + resolved.durationMin * 60_000);

      const deposit =
        depositCents === null
          ? null
          : {
              cents: depositCents,
              dueAt: depositDueAt(now, input.startsAt, opts.depositHoldHours ?? 24),
            };

      const created = await insertAppointment(
        tx,
        {
          clientId,
          clientName: input.client.name,
          clientEmail: email,
          staffId: input.staffId,
          locationId: input.locationId,
          startsAt: input.startsAt,
          endsAt,
          priceAppliedCents: resolved.priceCents,
          source: input.source,
          locale: input.locale ?? null,
          status: deposit ? "pending_deposit" : "booked",
          depositCents: deposit?.cents ?? null,
          depositDueAt: deposit?.dueAt ?? null,
          depositTermsAcceptedAt: deposit ? now : null,
          depositTermsText: deposit
            ? (opts.depositTermsText?.(deposit.cents) ?? defaultDepositTermsText(deposit.cents))
            : null,
        },
        resolved.lines,
        now,
      );

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

// Texto de la casilla cuando no lo da el formulario (scripts y tests)
function defaultDepositTermsText(cents: number): string {
  return `Entiendo que el depósito de ${(cents / 100).toFixed(2).replace(".", ",")} € no se devuelve si anulo la cita o no vengo.`;
}
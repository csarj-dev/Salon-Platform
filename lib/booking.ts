import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "../db";
import { depositCode, depositCredit, location, service } from "../db/schema";
import { insertAppointment, resolveServices, upsertClient } from "./appointment-create";
import { bookingInputSchema } from "./booking-schema";
import { getAvailabilityForDay, type AvailabilityOptions } from "./availability-db";
import { depositDueAt } from "./deposit";
import type { SavedDepositUse } from "./deposit-codes";
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
  // Paga el depósito con depósitos guardados (lib/deposit-codes.ts): la cita sale confirmada y,
  // en la misma transacción, se gastan esos depósitos y el código comprobado.
  savedDeposit?: SavedDepositUse;
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
      // Depósito por pagar (null si no hay, o si ya se pagó con depósitos guardados)
      deposit: { cents: number; dueAt: Date } | null;
      paidWithSavedDeposit: boolean;
    }
  | { ok: false; reason: "invalid_input"; issues: string[] }
  | { ok: false; reason: "slot_unavailable" | "slot_taken" }
  // Reserva web con depósito sin la casilla «el depósito no se devuelve»
  | { ok: false; reason: "deposit_terms" }
  // Los depósitos guardados ya no están (se usaron en otra reserva o caducaron) o el código ya se gastó
  | { ok: false; reason: "saved_deposit_gone" };

// Se lanza dentro de la transacción para deshacerla
class SavedDepositGone extends Error {}

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

// ¿Otra cita se quedó el hueco a la vez? Postgres lo dice con el choque de la regla anti-solape
// (23P01) o, si dos reservas comprueban esa regla en el mismo instante, cancelando una con un
// interbloqueo (40P01). En los dos casos la otra ha entrado: para esta, el hueco está ocupado.
export function isSlotConflict(e: unknown): boolean {
  const code = pgErrorCode(e);
  return code === "23P01" || code === "40P01";
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

      // Con depósitos guardados, el depósito ya está pagado: la cita sale confirmada
      const paidWithSaved = depositCents !== null && opts.savedDeposit !== undefined;
      const deposit =
        depositCents === null || paidWithSaved
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
          depositCents,
          depositDueAt: deposit?.dueAt ?? null,
          depositPaidAt: paidWithSaved ? now : null,
          depositTermsAcceptedAt: depositCents !== null ? now : null,
          depositTermsText:
            depositCents !== null
              ? (opts.depositTermsText?.(depositCents) ?? defaultDepositTermsText(depositCents))
              : null,
        },
        resolved.lines,
        now,
      );

      if (paidWithSaved && opts.savedDeposit) {
        const { creditIds, codeId } = opts.savedDeposit;
        // Cada depósito guardado y el código, una sola vez: si otra reserva se adelantó, nada
        const used = await tx
          .update(depositCredit)
          .set({ usedAt: now, usedAppointmentId: created.id })
          .where(
            and(
              inArray(depositCredit.id, creditIds),
              isNull(depositCredit.usedAt),
              gt(depositCredit.expiresAt, now),
            ),
          )
          .returning({ id: depositCredit.id });
        const consumed = await tx
          .update(depositCode)
          .set({ consumedAt: now })
          .where(and(eq(depositCode.id, codeId), isNull(depositCode.consumedAt)))
          .returning({ id: depositCode.id });
        if (used.length !== creditIds.length || consumed.length === 0) throw new SavedDepositGone();
      }

      return { created, deposit, paidWithSaved };
    });

    return {
      ok: true,
      appointmentId: result.created.id,
      publicToken: result.created.publicToken,
      status: result.deposit ? "pending_deposit" : "booked",
      deposit: result.deposit,
      paidWithSavedDeposit: result.paidWithSaved,
    };
  } catch (e) {
    if (e instanceof SavedDepositGone) return { ok: false, reason: "saved_deposit_gone" };
    // 23P01 = exclusion_violation: otra reserva se quedó el hueco un instante antes
    if (isSlotConflict(e)) return { ok: false, reason: "slot_taken" };
    throw e;
  }
}

// Texto de la casilla cuando no lo da el formulario (scripts y tests)
function defaultDepositTermsText(cents: number): string {
  return `Entiendo que el depósito de ${(cents / 100).toFixed(2).replace(".", ",")} € no se devuelve si anulo la cita o no vengo.`;
}
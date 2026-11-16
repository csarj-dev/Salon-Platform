// Citas creadas desde el panel (recepción). Diferencias con la reserva web (lib/booking.ts):
// - varios servicios seguidos, y la duración la pone recepción (de 5 en 5 min; el precio no cambia);
// - el depósito lo decide recepción: enlace de pago (pendiente, con plazo), ya pagado o sin depósito.
//   El importe sigue la regla del salón: uno por categoría (resolveServices → depositForServices);
// - sin antelación mínima ni días máximos;
// - si se pisa con otra cita no se guarda; fuera de turno, en una ausencia o un bloqueo, solo si
//   recepción lo confirma (`force`).
// Lo que comparte con la web (servicios, clienta, guardar) está en lib/appointment-create.ts.
// Koibox y el correo los hace la acción del panel, después de guardar (como la web).
import { and, count, eq, notInArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { appointment, client, staff } from "../db/schema";
import { insertAppointment, resolveServices, upsertClient } from "./appointment-create";
import { KoiboxUnavailableError, type SnapshotLoader } from "./availability-koibox";
import { pgErrorCode } from "./booking";
import { DURATION_MAX_MIN, DURATION_STEP_MIN, SERVICES_MAX } from "./booking-catalog";
import { clientDataSchema } from "./booking-schema";
import { depositDueAt } from "./deposit";
import type { SalonConfig } from "./salon-config";
import type { SlotClash, SlotWarning } from "./slot-check";
import { checkStaffSlot } from "./staff-slot";

// Los límites viven en booking-catalog.ts (sin base de datos), para que el panel los use también
export { DURATION_MAX_MIN, DURATION_STEP_MIN, SERVICES_MAX };

const STEP_MS = DURATION_STEP_MIN * 60_000;

export const staffBookingSchema = z.object({
  locationId: z.number().int().positive(),
  staffId: z.number().int().positive(),
  // En el orden en que se hacen. El primero es el servicio principal de la cita.
  serviceIds: z
    .array(z.number().int().positive())
    .min(1)
    .max(SERVICES_MAX)
    .refine((ids) => new Set(ids).size === ids.length, "Hay un servicio repetido"),
  startsAt: z.coerce.date().refine((d) => d.getTime() % STEP_MS === 0, "La hora va de 5 en 5 minutos"),
  durationMin: z
    .number()
    .int()
    .min(DURATION_STEP_MIN)
    .max(DURATION_MAX_MIN)
    .refine((m) => m % DURATION_STEP_MIN === 0, "La duración va de 5 en 5 minutos"),
  source: z.enum(["phone", "whatsapp"]).default("phone"),
  client: clientDataSchema,
  // link = mandarle el enlace de pago (queda pendiente con su plazo); paid = ya lo ha pagado;
  // none = sin depósito
  deposit: z.enum(["link", "paid", "none"]),
  // Seguir aunque caiga fuera de turno, en una ausencia o un bloqueo (recepción ya vio el aviso)
  force: z.boolean().default(false),
});

export type StaffBookingInput = z.input<typeof staffBookingSchema>;

export type StaffBookingResult =
  | {
      ok: true;
      appointmentId: number;
      status: "booked" | "pending_deposit";
      deposit: { cents: number; dueAt: Date | null } | null; // dueAt solo si está pendiente
    }
  | { ok: false; reason: "invalid_input"; issues: string[] }
  | { ok: false; reason: "staff_unavailable" } // no existe o no está activa
  | { ok: false; reason: "service_not_offered" | "service_not_done"; serviceNames: string[] }
  | { ok: false; reason: "clash"; clash: SlotClash }
  | { ok: false; reason: "needs_confirmation"; warnings: SlotWarning[] }
  | { ok: false; reason: "slot_taken" } // otra cita se quedó el hueco en ese mismo instante
  | { ok: false; reason: "koibox_unavailable" };

export async function createStaffAppointment(
  raw: unknown,
  config: SalonConfig,
  opts: { userId: string; now?: Date; loadFresh?: SnapshotLoader },
): Promise<StaffBookingResult> {
  const now = opts.now ?? new Date();
  const parsed = staffBookingSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid_input",
      issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }
  const input = parsed.data;

  // 1. La profesional existe y está activa
  const [member] = await db.select({ active: staff.active }).from(staff).where(eq(staff.id, input.staffId));
  if (!member?.active) return { ok: false, reason: "staff_unavailable" };

  // 2. Los servicios: existen, el local los ofrece y la profesional los hace
  const resolved = await resolveServices({
    locationId: input.locationId,
    staffId: input.staffId,
    serviceIds: input.serviceIds,
  });
  if (!resolved.ok) {
    if (resolved.reason === "unknown_service") {
      return { ok: false, reason: "invalid_input", issues: ["serviceIds: algún servicio no existe"] };
    }
    return resolved;
  }

  // 3. ¿Cabe a esa hora? (con la duración que puso recepción, no la suma)
  const endsAt = new Date(input.startsAt.getTime() + input.durationMin * 60_000);
  let check;
  try {
    check = await checkStaffSlot({
      staffId: input.staffId,
      locationId: input.locationId,
      startsAt: input.startsAt,
      endsAt,
      config,
      now,
      loadFresh: opts.loadFresh,
    });
  } catch (error) {
    if (error instanceof KoiboxUnavailableError) return { ok: false, reason: "koibox_unavailable" };
    throw error;
  }
  if (!check) return { ok: false, reason: "staff_unavailable" };
  if (check.clash) return { ok: false, reason: "clash", clash: check.clash };
  if (check.warnings.length > 0 && !input.force) {
    return { ok: false, reason: "needs_confirmation", warnings: check.warnings };
  }

  // 4. Depósito, según lo que eligió recepción
  const depositCents = input.deposit === "none" ? null : resolved.depositCents;
  const pending = input.deposit === "link" && depositCents !== null;
  const paid = input.deposit === "paid" && depositCents !== null;
  const dueAt = pending ? depositDueAt(now, input.startsAt, config.booking.deposit.holdHours) : null;

  // 5. Clienta, cita y servicios juntos o nada
  try {
    const created = await db.transaction(async (tx) => {
      const { clientId, email } = await upsertClient(tx, input.client, { now, consent: false });
      return insertAppointment(
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
          status: pending ? "pending_deposit" : "booked",
          depositCents: pending || paid ? depositCents : null,
          depositDueAt: dueAt,
          depositPaidAt: paid ? now : null,
          depositValidatedBy: paid ? opts.userId : null,
        },
        resolved.lines,
        now,
      );
    });

    return {
      ok: true,
      appointmentId: created.id,
      status: pending ? "pending_deposit" : "booked",
      deposit: pending || paid ? { cents: depositCents!, dueAt } : null,
    };
  } catch (error) {
    // 23P01 = exclusion_violation: otra cita se quedó el hueco un instante antes
    if (pgErrorCode(error) === "23P01") return { ok: false, reason: "slot_taken" };
    throw error;
  }
}

// ---- Buscar a la clienta por teléfono (al empezar a escribirlo en «Nueva cita») ----

export type ClientLookup = { id: number; name: string; email: string | null; appointments: number } | null;

const phoneSchema = clientDataSchema.shape.phone;

export async function findClientByPhone(raw: string): Promise<ClientLookup> {
  const parsed = phoneSchema.safeParse(raw);
  if (!parsed.success) return null;
  const [found] = await db
    .select({ id: client.id, name: client.name, email: client.email })
    .from(client)
    .where(eq(client.phone, parsed.data));
  if (!found) return null;
  // Citas que tuvo o tiene (las canceladas y caducadas no cuentan)
  const [row] = await db
    .select({ n: count() })
    .from(appointment)
    .where(and(eq(appointment.clientId, found.id), notInArray(appointment.status, ["cancelled", "expired"])));
  return { ...found, appointments: row?.n ?? 0 };
}
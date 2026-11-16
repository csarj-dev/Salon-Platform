// Reúne lo que hace falta para comprobar una hora del panel (crear o mover una cita) y llama a
// checkSlot. Los turnos, ausencias y bloqueos salen de loadAgendaColumns: lo mismo que pinta la
// agenda. En modo Koibox, con datos frescos (sin caché), como al confirmar una reserva web.
import { and, asc, eq, gt, lt, ne, notInArray, or } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "../db";
import { appointment, staff } from "../db/schema";
import { loadAgendaColumns, type AgendaKoibox } from "./agenda-db";
import { KoiboxUnavailableError, type SnapshotLoader } from "./availability-koibox";
import { freshKoiboxSnapshot } from "./koibox/snapshot-cache";
import type { SalonConfig } from "./salon-config";
import { checkSlot, type SlotCheck } from "./slot-check";

export type StaffSlotQuery = {
  staffId: number;
  locationId: number;
  startsAt: Date;
  endsAt: Date;
  config: SalonConfig;
  now: Date;
  // Al mover una cita: ella no cuenta en nuestra base. Su hora de antes (startsAt/endsAt) tampoco
  // en Koibox, pero solo si es la misma profesional: con otra, esa hora es de otra persona.
  ignore?: { appointmentId: number; startsAt?: Date; endsAt?: Date };
  loadFresh?: SnapshotLoader; // en los tests, el Koibox de mentira
};

// null = la profesional no existe. Si Koibox no responde, lanza KoiboxUnavailableError.
export async function checkStaffSlot(q: StaffSlotQuery): Promise<SlotCheck | null> {
  const zone = q.config.timezone;
  const date = DateTime.fromJSDate(q.startsAt, { zone }).toFormat("yyyy-MM-dd");

  const [member] = await db
    .select({ koiboxAccount: staff.koiboxAccount, koiboxUserId: staff.koiboxUserId })
    .from(staff)
    .where(eq(staff.id, q.staffId));
  if (!member) return null;

  // Modo Koibox y enlazada: los datos de su cuenta para ese día
  let koibox: AgendaKoibox | undefined;
  const account = member.koiboxAccount;
  if (
    q.config.booking.availability === "koibox" &&
    account !== null &&
    member.koiboxUserId !== null &&
    q.config.koibox.accounts[account]
  ) {
    try {
      const snapshot = await (q.loadFresh ?? freshKoiboxSnapshot)(account, date, date);
      koibox = { accounts: q.config.koibox.accounts, snapshots: { [account]: snapshot } };
    } catch (error) {
      throw new KoiboxUnavailableError(error);
    }
  }

  const [columns, ours] = await Promise.all([
    loadAgendaColumns({ date, zone, locationId: q.locationId, all: true, withAppointments: [q.staffId], koibox }),
    // Nuestras citas de esa profesional que se pisan con la hora (mismo criterio que la web:
    // canceladas y caducadas no ocupan; una pendiente de depósito, solo mientras no vence)
    db
      .select({
        id: appointment.id,
        clientName: appointment.clientName,
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
      })
      .from(appointment)
      .where(
        and(
          eq(appointment.staffId, q.staffId),
          notInArray(appointment.status, ["cancelled", "expired"]),
          or(ne(appointment.status, "pending_deposit"), gt(appointment.depositDueAt, q.now)),
          lt(appointment.startsAt, q.endsAt),
          gt(appointment.endsAt, q.startsAt),
          q.ignore ? ne(appointment.id, q.ignore.appointmentId) : undefined,
        ),
      )
      .orderBy(asc(appointment.startsAt)),
  ]);

  const column = columns.find((c) => c.staffId === q.staffId);
  if (!column) return null;

  return checkSlot({
    slot: { start: q.startsAt, end: q.endsAt },
    shifts: column.shifts,
    timeOff: column.timeOff,
    blocks: column.blocks,
    koiboxBusy: column.koiboxBusy,
    appointments: ours,
    ignore:
      q.ignore?.startsAt && q.ignore.endsAt ? { start: q.ignore.startsAt, end: q.ignore.endsAt } : undefined,
  });
}
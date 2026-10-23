import { and, asc, eq, gt, isNotNull, lte, notExists, sql } from "drizzle-orm";
import { db } from "../../db";
import { appointment, client, emailLog } from "../../db/schema";
import { sendAppointmentEmail } from "./appointment-email";
import {
  isReminderDue,
  reminderWindow,
  REMINDER_MAX_ATTEMPTS,
} from "./reminder-rules";

export type ReminderCandidateRow = {
  id: number;
  startsAt: Date;
  email: string;
};

// Citas que tienen que recibir ahora su recordatorio: confirmadas, con email, dentro de la
// ventana, sin recordatorio enviado (o en curso) y con menos de 3 intentos fallidos.
export function reminderCandidatesQuery(now: Date, limit = 200) {
  const { from, to } = reminderWindow(now);
  return db
    .select({
      id: appointment.id,
      startsAt: appointment.startsAt,
      createdAt: appointment.createdAt,
      depositPaidAt: appointment.depositPaidAt,
      email: client.email,
    })
    .from(appointment)
    .innerJoin(client, eq(client.id, appointment.clientId))
    .where(
      and(
        eq(appointment.status, "booked"),
        gt(appointment.startsAt, from),
        lte(appointment.startsAt, to),
        isNotNull(client.email),
        notExists(
          db
            .select({ one: sql`1` })
            .from(emailLog)
            .where(
              and(
                eq(emailLog.appointmentId, appointment.id),
                eq(emailLog.kind, "reminder"),
                sql`${emailLog.status} <> 'failed'`,
              ),
            ),
        ),
        sql`(select count(*) from ${emailLog} where ${emailLog.appointmentId} = ${appointment.id} and ${emailLog.kind} = 'reminder' and ${emailLog.status} = 'failed') < ${REMINDER_MAX_ATTEMPTS}`,
      ),
    )
    .orderBy(asc(appointment.startsAt))
    .limit(limit);
}

export async function findDueReminders(now: Date): Promise<ReminderCandidateRow[]> {
  const rows = await reminderCandidatesQuery(now);
  return rows
    .filter((r) =>
      isReminderDue(
        {
          status: "booked",
          startsAt: r.startsAt,
          confirmedAt: r.depositPaidAt ?? r.createdAt,
          hasEmail: r.email !== null,
        },
        now,
      ),
    )
    .map((r) => ({ id: r.id, startsAt: r.startsAt, email: r.email! }));
}

export type ReminderSummary = {
  checked: number;
  sent: number;
  failed: number;
  // Otra ejecución se adelantó o la clienta ya no tiene email
  skipped: number;
};

type SendOptions = NonNullable<Parameters<typeof sendAppointmentEmail>[2]>;

// Envía los recordatorios que tocan. Se puede ejecutar tantas veces como se quiera:
// cada cita recibe uno solo (lo garantiza el índice único de email_log).
export async function sendDueReminders(
  now: Date = new Date(),
  opts: Omit<SendOptions, "now"> = {},
): Promise<ReminderSummary> {
  const due = await findDueReminders(now);
  const summary: ReminderSummary = { checked: due.length, sent: 0, failed: 0, skipped: 0 };

  // Uno detrás de otro: son pocos y así no se supera el límite por segundo del proveedor
  for (const item of due) {
    const outcome = await sendAppointmentEmail(item.id, "reminder", { ...opts, now });
    if (outcome.ok) summary.sent++;
    else if (outcome.reason === "send_failed") summary.failed++;
    else summary.skipped++;
  }
  return summary;
}
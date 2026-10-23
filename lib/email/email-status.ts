import { desc, inArray } from "drizzle-orm";
import { db } from "../../db";
import { emailLog } from "../../db/schema";

export type EmailStatusInfo = {
  kind: "confirmation" | "cancellation" | "reminder";
  status: "pending" | "sent" | "failed";
  error: string | null;
  at: Date;
};

// Último correo registrado de cada cita (para mostrarlo en el panel)
export async function latestEmailByAppointment(
  appointmentIds: number[],
): Promise<Map<number, EmailStatusInfo>> {
  const result = new Map<number, EmailStatusInfo>();
  if (appointmentIds.length === 0) return result;

  const rows = await db
    .select()
    .from(emailLog)
    .where(inArray(emailLog.appointmentId, appointmentIds))
    .orderBy(desc(emailLog.id));

  // Vienen del más reciente al más antiguo: el primero de cada cita es el último
  for (const row of rows) {
    if (result.has(row.appointmentId)) continue;
    result.set(row.appointmentId, {
      kind: row.kind,
      status: row.status,
      error: row.error,
      at: row.sentAt ?? row.createdAt,
    });
  }
  return result;
}
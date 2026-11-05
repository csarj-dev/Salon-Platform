// El cobrador de una cita o de una profesional, leyendo de la base lo que hace falta
// (su columna collector y su cuenta de Koibox). La regla está en lib/collectors.ts.
import { asc, eq } from "drizzle-orm";
import { db } from "../db";
import { appointment, staff } from "../db/schema";
import { chooseCollector, resolveCollector, type Collector, type CollectorChoice } from "./collectors";
import type { SalonConfig } from "./salon-config";

type Config = Parameters<typeof resolveCollector>[0];

export async function collectorForStaff(staffId: number, config: Config): Promise<Collector> {
  const [row] = await db
    .select({ collector: staff.collector, koiboxAccount: staff.koiboxAccount })
    .from(staff)
    .where(eq(staff.id, staffId));
  return resolveCollector(config, { staffCollector: row?.collector, koiboxAccount: row?.koiboxAccount });
}

export async function collectorForAppointment(appointmentId: number, config: Config): Promise<Collector> {
  const [row] = await db
    .select({ collector: staff.collector, koiboxAccount: staff.koiboxAccount })
    .from(appointment)
    .innerJoin(staff, eq(staff.id, appointment.staffId))
    .where(eq(appointment.id, appointmentId));
  return resolveCollector(config, { staffCollector: row?.collector, koiboxAccount: row?.koiboxAccount });
}

export type StaffCollectorRow = {
  staffId: number;
  staffName: string;
  active: boolean;
  koiboxAccount: string | null;
  saved: string | null; // lo guardado en su columna
  choice: CollectorChoice;
};

// Todas las profesionales con su cobrador y de dónde sale (para db/collectors.ts list)
export async function listStaffCollectors(config: Pick<SalonConfig, "name" | "contact" | "booking" | "koibox" | "payments">): Promise<StaffCollectorRow[]> {
  const rows = await db
    .select({
      id: staff.id,
      name: staff.name,
      active: staff.active,
      koiboxAccount: staff.koiboxAccount,
      collector: staff.collector,
    })
    .from(staff)
    .orderBy(asc(staff.name));
  return rows.map((r) => ({
    staffId: r.id,
    staffName: r.name,
    active: r.active,
    koiboxAccount: r.koiboxAccount,
    saved: r.collector,
    choice: chooseCollector(config, { staffCollector: r.collector, koiboxAccount: r.koiboxAccount }),
  }));
}
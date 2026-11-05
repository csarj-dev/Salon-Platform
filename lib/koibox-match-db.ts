// Emparejar con Koibox: leer lo nuestro de la base, pedir a Koibox sus servicios y guardar lo seguro.
// La lógica de emparejar está en lib/koibox/match.ts; el script es db/koibox-match.ts.
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { koiboxServiceMap, service, staff } from "../db/schema";
import { pgErrorCode } from "./booking";
import { koiboxUsersOf, planServiceMatches, planStaffMatches, type ServicePlan, type StaffPlan } from "./koibox/match";
import type { KoiboxApiFor } from "./koibox-sync";
import type { SalonConfig } from "./salon-config";

export type MatchPlan = {
  staff: StaffPlan;
  services: ServicePlan[]; // uno por cuenta que respondió
  errors: { account: string; message: string }[]; // cuentas que no respondieron
};

export async function planKoiboxMatches(config: Pick<SalonConfig, "koibox">, apiFor: KoiboxApiFor): Promise<MatchPlan> {
  const [ourServices, ourStaff, links] = await Promise.all([
    db.select({ id: service.id, name: service.name, durationMin: service.durationMin }).from(service).orderBy(asc(service.name)),
    db
      .select({ id: staff.id, name: staff.name, koiboxAccount: staff.koiboxAccount, koiboxUserId: staff.koiboxUserId })
      .from(staff)
      .where(eq(staff.active, true))
      .orderBy(asc(staff.name)),
    db.select().from(koiboxServiceMap),
  ]);

  const services: ServicePlan[] = [];
  const users: ReturnType<typeof koiboxUsersOf> = [];
  const errors: MatchPlan["errors"] = [];
  // Una cuenta detrás de otra: así un fallo en una no impide ver las demás
  for (const account of Object.keys(config.koibox.accounts)) {
    try {
      const theirs = await apiFor(account).listServices();
      users.push(...koiboxUsersOf(account, theirs.filter((s) => s.is_active !== false)));
      services.push(
        planServiceMatches({ account, ours: ourServices, theirs, linked: links.filter((l) => l.account === account) }),
      );
    } catch (error) {
      errors.push({ account, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { staff: planStaffMatches(ourStaff, users), services, errors };
}

export type ApplySummary = { staffLinked: number; servicesLinked: number; skipped: string[] };

// Guarda solo lo seguro y nunca pisa: una profesional que ya tiene cuenta, o un servicio que ya
// tiene id en esa cuenta, se quedan como están (aunque entretanto alguien los haya enlazado a mano).
export async function applyKoiboxMatches(plan: MatchPlan): Promise<ApplySummary> {
  const summary: ApplySummary = { staffLinked: 0, servicesLinked: 0, skipped: [] };

  for (const { ours, theirs } of plan.staff.link) {
    try {
      const updated = await db
        .update(staff)
        .set({ koiboxAccount: theirs.account, koiboxUserId: theirs.id })
        .where(and(eq(staff.id, ours.id), isNull(staff.koiboxAccount)))
        .returning({ id: staff.id });
      if (updated.length > 0) summary.staffLinked++;
      else summary.skipped.push(`${ours.name}: ya tenía cuenta de Koibox`);
    } catch (error) {
      // 23505: esa usuaria de Koibox ya es otra persona de nuestro equipo
      if (pgErrorCode(error) !== "23505") throw error;
      summary.skipped.push(`${ours.name}: la usuaria ${theirs.id} de "${theirs.account}" ya está enlazada con otra profesional`);
    }
  }

  for (const plan_ of plan.services) {
    for (const { ours, theirs } of plan_.link) {
      const inserted = await db
        .insert(koiboxServiceMap)
        .values({ serviceId: ours.id, account: plan_.account, koiboxServiceId: theirs.id })
        .onConflictDoNothing()
        .returning({ serviceId: koiboxServiceMap.serviceId });
      if (inserted.length > 0) summary.servicesLinked++;
      else summary.skipped.push(`${ours.name}: ya tenía id en "${plan_.account}"`);
    }
  }
  return summary;
}
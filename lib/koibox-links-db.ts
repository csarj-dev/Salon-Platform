// Enlaces de nuestras profesionales con Koibox desde el panel (lo mismo que db/koibox-link.ts staff).
import { asc, eq } from "drizzle-orm";
import { db } from "../db";
import { koiboxServiceMap, service, staff, staffService } from "../db/schema";
import { pgErrorCode } from "./booking";
import { koiboxDriver, type KoiboxEnv } from "./koibox/driver";
import { koiboxUsersOf, type KoiboxUser } from "./koibox/match";
import { koiboxApiFor, type KoiboxApiFor } from "./koibox-sync";
import type { SalonConfig } from "./salon-config";

type Config = Pick<SalonConfig, "koibox">;

export type AccountSummary = {
  id: string;
  label: string;
  keyEnv: string;
  // "fake": Koibox de mentira (no hace falta clave); "missing": falta la variable de entorno
  key: "fake" | "ok" | "missing";
  staffCount: number;
  servicesLinked: number;
};

export type StaffKoiboxRow = {
  staffId: number;
  staffName: string;
  account: string | null;
  userId: number | null;
  unknownAccount: boolean; // su cuenta ya no está en el config
  missingServices: string[]; // servicios que hace y no tienen id en su cuenta
};

export type KoiboxOverview = { accounts: AccountSummary[]; staff: StaffKoiboxRow[] };

const hasAccount = (config: Config, id: string) => Object.hasOwn(config.koibox.accounts, id);

export async function loadKoiboxOverview(config: Config, env: KoiboxEnv = process.env): Promise<KoiboxOverview> {
  const [team, skills, services, links] = await Promise.all([
    db
      .select({ id: staff.id, name: staff.name, account: staff.koiboxAccount, userId: staff.koiboxUserId })
      .from(staff)
      .where(eq(staff.active, true))
      .orderBy(asc(staff.name)),
    db.select().from(staffService),
    db.select({ id: service.id, name: service.name }).from(service),
    db.select().from(koiboxServiceMap),
  ]);

  const fake = koiboxDriver(env) === "fake";
  const accounts: AccountSummary[] = Object.entries(config.koibox.accounts).map(([id, a]) => ({
    id,
    label: a.label,
    keyEnv: a.keyEnv,
    key: fake ? "fake" : env[a.keyEnv]?.trim() ? "ok" : "missing",
    staffCount: team.filter((m) => m.account === id).length,
    servicesLinked: links.filter((l) => l.account === id).length,
  }));

  const nameOf = new Map(services.map((s) => [s.id, s.name]));
  const staffRows: StaffKoiboxRow[] = team.map((m) => {
    const known = m.account !== null && hasAccount(config, m.account);
    const missingServices = known
      ? skills
          .filter((s) => s.staffId === m.id)
          .filter((s) => !links.some((l) => l.serviceId === s.serviceId && l.account === m.account))
          .map((s) => nameOf.get(s.serviceId) ?? `#${s.serviceId}`)
          .sort((a, b) => a.localeCompare(b))
      : [];
    return {
      staffId: m.id,
      staffName: m.name,
      account: m.account,
      userId: m.userId,
      unknownAccount: m.account !== null && !known,
      missingServices,
    };
  });

  return { accounts, staff: staffRows };
}

export type LinkResult = "ok" | "notFound" | "unknownAccount" | "userTaken";

// null = quitar de Koibox (sus horas vuelven a salir del horario de nuestra base)
export async function setStaffKoiboxLink(
  config: Config,
  staffId: number,
  link: { account: string; userId: number } | null,
): Promise<LinkResult> {
  if (link && !hasAccount(config, link.account)) return "unknownAccount";
  try {
    const updated = await db
      .update(staff)
      .set(link ? { koiboxAccount: link.account, koiboxUserId: link.userId } : { koiboxAccount: null, koiboxUserId: null })
      .where(eq(staff.id, staffId))
      .returning({ id: staff.id });
    return updated.length > 0 ? "ok" : "notFound";
  } catch (error) {
    // 23505: esa usuaria de Koibox ya es otra profesional (índice staff_koibox_user_once)
    if (pgErrorCode(error) === "23505") return "userTaken";
    throw error;
  }
}

// Koibox no tiene lista de empleadas: salen de quién hace cada servicio activo de la cuenta
export async function koiboxUsersForAccount(
  config: Config,
  account: string,
  apiFor: KoiboxApiFor = koiboxApiFor(config),
): Promise<KoiboxUser[]> {
  const services = await apiFor(account).listServices();
  return koiboxUsersOf(account, services.filter((s) => s.is_active !== false));
}
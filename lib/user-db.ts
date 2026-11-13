import { asc, eq, max } from "drizzle-orm";
import { db } from "../db";
import { session, user } from "../db/schema";

export type PanelUser = {
  id: string;
  name: string;
  email: string;
  role: string | null;
  banned: boolean;
  createdAt: Date;
  /** Último inicio de sesión o actividad conocida. null = nunca ha entrado. */
  lastSeenAt: Date | null;
};

const toDate = (value: Date | string | null): Date | null =>
  value === null ? null : value instanceof Date ? value : new Date(value);

/** La más reciente de varias fechas, ignorando las que faltan. */
export function latestDate(...dates: (Date | null)[]): Date | null {
  return dates.reduce<Date | null>(
    (latest, d) => (d && (!latest || d > latest) ? d : latest),
    null,
  );
}

/**
 * Usuarios del panel con su último acceso. Se combinan dos fuentes:
 * - user.lastLoginAt: se apunta en cada inicio de sesión y no se pierde.
 * - la sesión viva más reciente: cubre a quien ya estaba dentro antes de la columna.
 */
export async function listPanelUsers(): Promise<PanelUser[]> {
  const lastSession = db
    .select({ userId: session.userId, at: max(session.updatedAt).as("at") })
    .from(session)
    .groupBy(session.userId)
    .as("last_session");

  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      banned: user.banned,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      lastSessionAt: lastSession.at,
    })
    .from(user)
    .leftJoin(lastSession, eq(lastSession.userId, user.id))
    .orderBy(asc(user.createdAt));

  return rows.map(({ lastLoginAt, lastSessionAt, banned, ...rest }) => ({
    ...rest,
    banned: Boolean(banned),
    lastSeenAt: latestDate(toDate(lastLoginAt), toDate(lastSessionAt)),
  }));
}
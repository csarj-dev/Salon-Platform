import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { auth } from "./auth";
import { can, isStaff, type Permission } from "./permissions";

/** Sesión actual o null. Solo desde el servidor. Lee headers, así que es dinámico. */
export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

function roleOf(user: object): string | null {
  const role = (user as { role?: string | null }).role;
  return role ?? null;
}

/**
 * Exige una persona del equipo con sesión válida (y, si se indica, con ese permiso).
 * Llámala en CADA página y acción del panel, no solo en el layout: un layout no
 * se vuelve a ejecutar al navegar entre páginas hijas.
 * Sin sesión o sin rol → login. Con sesión pero sin permiso → 404.
 */
export async function requireStaff(locale: string, permission?: Permission) {
  const session = await getSession();
  if (!session || !isStaff(roleOf(session.user))) {
    // `as never`: redirect lanza una excepción; así TypeScript sabe que debajo hay sesión
    return redirect({ href: "/admin/login", locale }) as never;
  }
  const role = roleOf(session.user);
  if (permission && !can(role, permission)) notFound();
  return { user: session.user, role };
}

/** ¿Hay ya una sesión de equipo? (para saltar el login) */
export async function hasStaffSession() {
  const session = await getSession();
  return Boolean(session && isStaff(roleOf(session.user)));
}
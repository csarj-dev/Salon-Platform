import { isRole, parseRoles, type Role } from "./permissions";

export type UserRuleError = "invalidRole" | "selfRole" | "selfDeactivate" | "lastAdmin";

export type RuleUser = { id: string; role: string | null; banned: boolean | null };

const isAdmin = (u: RuleUser) => parseRoles(u.role).includes("admin");
const isActive = (u: RuleUser) => !u.banned;

/** Administradores activos (no desactivados). */
export function countActiveAdmins(users: RuleUser[]): number {
  return users.filter((u) => isAdmin(u) && isActive(u)).length;
}

/** null = permitido. Si no, el motivo por el que se rechaza. */
export function checkRoleChange(input: {
  actorId: string;
  target: RuleUser;
  newRole: string;
  activeAdmins: number;
}): UserRuleError | null {
  const { actorId, target, newRole, activeAdmins } = input;
  if (!isRole(newRole)) return "invalidRole";
  if (target.id === actorId) return "selfRole";
  if (isAdmin(target) && isActive(target) && newRole !== "admin" && activeAdmins <= 1) {
    return "lastAdmin";
  }
  return null;
}

export function checkDeactivate(input: {
  actorId: string;
  target: RuleUser;
  activeAdmins: number;
}): UserRuleError | null {
  const { actorId, target, activeAdmins } = input;
  if (target.id === actorId) return "selfDeactivate";
  if (isAdmin(target) && isActive(target) && activeAdmins <= 1) return "lastAdmin";
  return null;
}

// Límites de contraseña, compartidos por las acciones y el diálogo
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export type UserUpdateError = UserRuleError | "invalid";
export type UserUpdatePlan = { role: Role | null; password: string | null };

/**
 * Decide qué hay que cambiar al guardar el diálogo de un usuario, antes de
 * tocar nada: si algo no vale, no se cambia ninguna de las dos cosas.
 * - newRole: el rol elegido (null = no se envió). Si es el que ya tiene, no se toca.
 * - password: vacía = no se cambia.
 */
export function planUserUpdate(input: {
  actorId: string;
  target: RuleUser;
  newRole: string | null;
  password: string;
  activeAdmins: number;
}): { ok: true; plan: UserUpdatePlan } | { ok: false; error: UserUpdateError } {
  const { actorId, target, newRole, password, activeAdmins } = input;

  let role: Role | null = null;
  if (newRole !== null && newRole !== parseRoles(target.role)[0]) {
    if (!isRole(newRole)) return { ok: false, error: "invalidRole" };
    const blocked = checkRoleChange({ actorId, target, newRole, activeAdmins });
    if (blocked) return { ok: false, error: blocked };
    role = newRole;
  }

  if (password !== "" && (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX)) {
    return { ok: false, error: "invalid" };
  }

  return { ok: true, plan: { role, password: password === "" ? null : password } };
}
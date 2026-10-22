import { isRole, parseRoles } from "./permissions";

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
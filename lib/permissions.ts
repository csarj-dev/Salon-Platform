export const ROLES = ["admin", "owner", "reception"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = {
  "users.manage": ["admin"],
  "appointments.view": ["admin", "owner", "reception"],
  "appointments.manage": ["admin", "owner", "reception"],
  "deposits.manage": ["admin", "owner", "reception"],
  "reports.view": ["admin", "owner"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Better Auth guarda los roles como texto separado por comas ("admin,owner"). */
export function parseRoles(raw: string | null | undefined): Role[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((r) => r.trim())
    .filter(isRole);
}

export function can(raw: string | null | undefined, permission: Permission): boolean {
  const allowed: readonly Role[] = PERMISSIONS[permission];
  return parseRoles(raw).some((role) => allowed.includes(role));
}

/** ¿Tiene al menos un rol válido? Un usuario sin rol no entra al panel. */
export function isStaff(raw: string | null | undefined): boolean {
  return parseRoles(raw).length > 0;
}
export const ROLES = ["admin", "owner", "reception"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = {
  "users.manage": ["admin"],
  "appointments.view": ["admin", "owner", "reception"],
  "appointments.manage": ["admin", "owner", "reception"],
  "deposits.manage": ["admin", "owner", "reception"],
  "reports.view": ["admin", "owner"],
  // Ajustes del salón desde el panel: cobros y enlaces con Koibox
  "settings.manage": ["admin", "owner"],
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

export type PermissionRow = { permission: Permission; allowed: Record<Role, boolean> };

/**
 * «Qué puede hacer cada rol», sacado de PERMISSIONS. La página de Usuarios lo
 * pinta tal cual, así nunca dice algo distinto de lo que el código comprueba.
 */
export function permissionMatrix(): PermissionRow[] {
  return (Object.keys(PERMISSIONS) as Permission[]).map((permission) => {
    const allowedRoles: readonly Role[] = PERMISSIONS[permission];
    return {
      permission,
      allowed: Object.fromEntries(
        ROLES.map((role) => [role, allowedRoles.includes(role)]),
      ) as Record<Role, boolean>,
    };
  });
}
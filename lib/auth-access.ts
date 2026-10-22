import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements, adminAc } from "better-auth/plugins/admin/access";

const ac = createAccessControl(defaultStatements);

// admin: todo lo que trae el plugin (crear usuarios, cambiar roles, bloquear...)
// owner y reception: nada de gestión de usuarios. Sus permisos de negocio
// viven en lib/permissions.ts.
export const roles = {
  admin: ac.newRole(adminAc.statements),
  owner: ac.newRole({}),
  reception: ac.newRole({}),
};

export { ac };
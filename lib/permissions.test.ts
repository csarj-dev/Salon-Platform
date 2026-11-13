import { describe, expect, it } from "vitest";
import { can, isRole, isStaff, parseRoles, permissionMatrix, PERMISSIONS, ROLES } from "./permissions";

describe("parseRoles", () => {
  it("ignora vacío, nulo y roles desconocidos", () => {
    expect(parseRoles(null)).toEqual([]);
    expect(parseRoles("")).toEqual([]);
    expect(parseRoles("superuser")).toEqual([]);
  });
  it("lee varios roles separados por coma", () => {
    expect(parseRoles("owner, reception")).toEqual(["owner", "reception"]);
  });
});

describe("isRole", () => {
  it("solo acepta los roles fijos", () => {
    expect(isRole("admin")).toBe(true);
    expect(isRole("user")).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });
});

describe("can", () => {
  it("solo el admin gestiona usuarios", () => {
    expect(can("admin", "users.manage")).toBe(true);
    expect(can("owner", "users.manage")).toBe(false);
    expect(can("reception", "users.manage")).toBe(false);
  });
  it("recepción valida citas y depósitos pero no ve informes", () => {
    expect(can("reception", "appointments.manage")).toBe(true);
    expect(can("reception", "deposits.manage")).toBe(true);
    expect(can("reception", "reports.view")).toBe(false);
  });
  it("la dueña ve informes", () => {
    expect(can("owner", "reports.view")).toBe(true);
  });
  it("sin rol no hay permisos", () => {
    expect(can(null, "appointments.view")).toBe(false);
    expect(can("user", "appointments.view")).toBe(false);
  });
  it("administrador y dirección cambian los ajustes; recepción no", () => {
    expect(can("admin", "settings.manage")).toBe(true);
    expect(can("owner", "settings.manage")).toBe(true);
    expect(can("reception", "settings.manage")).toBe(false);
  });
});

describe("isStaff", () => {
  it("exige al menos un rol válido", () => {
    expect(isStaff("reception")).toBe(true);
    expect(isStaff("owner,foo")).toBe(true);
    expect(isStaff("user")).toBe(false);
    expect(isStaff(null)).toBe(false);
  });
});

describe("permissionMatrix", () => {
  it("una fila por permiso, en el mismo orden que PERMISSIONS", () => {
    expect(permissionMatrix().map((r) => r.permission)).toEqual(Object.keys(PERMISSIONS));
  });
  it("cada fila tiene todos los roles y coincide con can()", () => {
    for (const row of permissionMatrix()) {
      expect(Object.keys(row.allowed)).toEqual([...ROLES]);
      for (const role of ROLES) {
        expect(row.allowed[role]).toBe(can(role, row.permission));
      }
    }
  });
  it("usuarios solo para el administrador", () => {
    const users = permissionMatrix().find((r) => r.permission === "users.manage");
    expect(users?.allowed).toEqual({ admin: true, owner: false, reception: false });
  });
});
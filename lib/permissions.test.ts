import { describe, expect, it } from "vitest";
import { can, isRole, isStaff, parseRoles } from "./permissions";

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
});

describe("isStaff", () => {
  it("exige al menos un rol válido", () => {
    expect(isStaff("reception")).toBe(true);
    expect(isStaff("owner,foo")).toBe(true);
    expect(isStaff("user")).toBe(false);
    expect(isStaff(null)).toBe(false);
  });
});
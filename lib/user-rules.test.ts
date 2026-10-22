import { describe, expect, it } from "vitest";
import {
  checkDeactivate,
  checkRoleChange,
  countActiveAdmins,
  type RuleUser,
} from "./user-rules";

const admin = (id: string, banned = false): RuleUser => ({ id, role: "admin", banned });
const reception = (id: string): RuleUser => ({ id, role: "reception", banned: false });

describe("countActiveAdmins", () => {
  it("no cuenta desactivados ni otros roles", () => {
    expect(countActiveAdmins([admin("a"), admin("b", true), reception("c")])).toBe(1);
  });
});

describe("checkRoleChange", () => {
  it("rechaza roles inventados", () => {
    expect(
      checkRoleChange({ actorId: "a", target: reception("c"), newRole: "root", activeAdmins: 2 }),
    ).toBe("invalidRole");
  });
  it("no deja cambiar el propio rol", () => {
    expect(
      checkRoleChange({ actorId: "a", target: admin("a"), newRole: "owner", activeAdmins: 2 }),
    ).toBe("selfRole");
  });
  it("no deja quitar el rol al último admin activo", () => {
    expect(
      checkRoleChange({ actorId: "a", target: admin("b"), newRole: "owner", activeAdmins: 1 }),
    ).toBe("lastAdmin");
  });
  it("permite degradar a un admin si queda otro", () => {
    expect(
      checkRoleChange({ actorId: "a", target: admin("b"), newRole: "owner", activeAdmins: 2 }),
    ).toBeNull();
  });
  it("permite subir a recepción a dueña", () => {
    expect(
      checkRoleChange({ actorId: "a", target: reception("c"), newRole: "owner", activeAdmins: 1 }),
    ).toBeNull();
  });
});

describe("checkDeactivate", () => {
  it("no deja desactivarse a uno mismo", () => {
    expect(checkDeactivate({ actorId: "a", target: admin("a"), activeAdmins: 2 })).toBe(
      "selfDeactivate",
    );
  });
  it("no deja desactivar al último admin activo", () => {
    expect(checkDeactivate({ actorId: "a", target: admin("b"), activeAdmins: 1 })).toBe(
      "lastAdmin",
    );
  });
  it("permite desactivar recepción", () => {
    expect(checkDeactivate({ actorId: "a", target: reception("c"), activeAdmins: 1 })).toBeNull();
  });
});
import { describe, it, expect } from "vitest";
import { parseTeamArgs } from "./team-cli";

describe("parseTeamArgs", () => {
  it("lee el id, los textos por idioma y la publicación", () => {
    expect(
      parseTeamArgs(["3", "--role-es", "Estilista de cejas", "--bio-en", "Brow stylist", "--list"]),
    ).toEqual({
      staffId: 3,
      role: { es: "Estilista de cejas" },
      bio: { en: "Brow stylist" },
      listing: "list",
    });
  });

  it("acepta solo --unlist", () => {
    expect(parseTeamArgs(["3", "--unlist"]).listing).toBe("unlist");
  });

  it("rechaza --list y --unlist juntos", () => {
    expect(() => parseTeamArgs(["3", "--list", "--unlist"])).toThrow(/a la vez/);
  });

  it("rechaza si no hay nada que cambiar", () => {
    expect(() => parseTeamArgs(["3"])).toThrow(/nada que cambiar/);
  });

  it("rechaza ids no válidos o ausentes", () => {
    expect(() => parseTeamArgs(["abc", "--list"])).toThrow(/Id no válido/);
    expect(() => parseTeamArgs(["0", "--list"])).toThrow(/Id no válido/);
    expect(() => parseTeamArgs(["--list"])).toThrow(/Uso:/);
  });

  it("rechaza opciones desconocidas y textos sin valor", () => {
    expect(() => parseTeamArgs(["3", "--foo"])).toThrow(/Opción desconocida/);
    expect(() => parseTeamArgs(["3", "--role-es"])).toThrow(/Falta el texto/);
    expect(() => parseTeamArgs(["3", "--role-es", "--list"])).toThrow(/Falta el texto/);
  });
});
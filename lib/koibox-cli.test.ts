import { describe, expect, it } from "vitest";
import { parseKoiboxLinkArgs } from "./koibox-cli";

const accounts = ["salon", "amanda", "luz"];
const parse = (args: string[]) => parseKoiboxLinkArgs(args, accounts);

describe("parseKoiboxLinkArgs", () => {
  it("list", () => {
    expect(parse(["list"])).toEqual({ kind: "list" });
    expect(() => parse(["list", "3"])).toThrow(/no lleva/);
  });

  it("enlaza una profesional", () => {
    expect(parse(["staff", "3", "--account", "salon", "--user", "1234"])).toEqual({
      kind: "staff",
      staffId: 3,
      account: "salon",
      userId: 1234,
    });
  });

  it("desenlaza una profesional", () => {
    expect(parse(["staff", "3", "--clear"])).toEqual({ kind: "staff-clear", staffId: 3 });
    expect(() => parse(["staff", "3", "--clear", "--user", "1"])).toThrow(/no se combina/);
  });

  it("enlaza y desenlaza un servicio en una cuenta", () => {
    expect(parse(["service", "7", "--koibox", "5678", "--account", "amanda"])).toEqual({
      kind: "service",
      serviceId: 7,
      account: "amanda",
      koiboxServiceId: 5678,
    });
    expect(parse(["service", "7", "--account", "amanda", "--clear"])).toEqual({
      kind: "service-clear",
      serviceId: 7,
      account: "amanda",
    });
  });

  it("rechaza cuentas que no están en el config", () => {
    expect(() => parse(["staff", "3", "--account", "otra", "--user", "1"])).toThrow(/desconocida \(hay: salon, amanda, luz\)/);
    expect(() => parseKoiboxLinkArgs(["staff", "3", "--account", "salon", "--user", "1"], [])).toThrow(/no tiene cuentas/);
  });

  it("rechaza ids no válidos y opciones mal puestas", () => {
    expect(() => parse(["staff", "x", "--account", "salon", "--user", "1"])).toThrow(/Id no válido/);
    expect(() => parse(["staff", "3", "--account", "salon", "--user", "0"])).toThrow(/no válido/);
    expect(() => parse(["staff", "3", "--account", "salon"])).toThrow(/Faltan --account y --user/);
    expect(() => parse(["staff", "3", "--account", "salon", "--koibox", "1"])).toThrow(/va con --user/);
    expect(() => parse(["service", "7", "--account", "salon", "--user", "1"])).toThrow(/va con --koibox/);
    expect(() => parse(["service", "7", "--koibox", "1"])).toThrow(/Falta --account/);
    expect(() => parse(["service", "7", "--account"])).toThrow(/Falta el valor/);
    expect(() => parse(["staff", "3", "--foo"])).toThrow(/Opción desconocida/);
    expect(() => parse(["borrar"])).toThrow(/Uso:/);
  });
});
import { describe, it, expect } from "vitest";
import { parseDepositsArgs, parseEuros, parseServiceDepositArgs } from "./deposit-cli";

describe("parseEuros", () => {
  it("convierte euros en céntimos", () => {
    expect(parseEuros("20")).toBe(2000);
    expect(parseEuros("15,50")).toBe(1550);
    expect(parseEuros("7.5")).toBe(750);
    expect(parseEuros("20.10")).toBe(2010);
  });

  it("rechaza lo que no es un importe", () => {
    for (const bad of ["", "abc", "-5", "1,234", "1.2.3", "5€"]) {
      expect(() => parseEuros(bad)).toThrow(/Importe no válido/);
    }
  });

  it("rechaza cero", () => {
    expect(() => parseEuros("0")).toThrow(/mayor que cero/);
  });
});

describe("parseServiceDepositArgs", () => {
  it("lee el servicio y el importe", () => {
    expect(parseServiceDepositArgs(["31", "--amount", "15,50"])).toEqual({
      serviceId: 31,
      depositCents: 1550,
    });
  });

  it("--none quita el depósito", () => {
    expect(parseServiceDepositArgs(["31", "--none"])).toEqual({ serviceId: 31, depositCents: null });
  });

  it("rechaza lo ambiguo o incompleto", () => {
    expect(() => parseServiceDepositArgs(["31"])).toThrow(/nada que cambiar/);
    expect(() => parseServiceDepositArgs(["31", "--amount", "5", "--none"])).toThrow(/a la vez/);
    expect(() => parseServiceDepositArgs(["31", "--none", "--amount", "5"])).toThrow(/a la vez/);
    expect(() => parseServiceDepositArgs(["31", "--amount"])).toThrow(/Falta el valor/);
    expect(() => parseServiceDepositArgs(["--none"])).toThrow(/Uso:/);
    expect(() => parseServiceDepositArgs(["x", "--none"])).toThrow(/Id no válido/);
    expect(() => parseServiceDepositArgs(["31", "--foo"])).toThrow(/Opción desconocida/);
  });
});

describe("parseDepositsArgs", () => {
  it("list, con o sin caducadas", () => {
    expect(parseDepositsArgs(["list"])).toEqual({ command: "list", expired: false });
    expect(parseDepositsArgs(["list", "--expired"])).toEqual({ command: "list", expired: true });
  });

  it("paid necesita el id de la cita", () => {
    expect(parseDepositsArgs(["paid", "12"])).toEqual({ command: "paid", appointmentId: 12 });
    expect(() => parseDepositsArgs(["paid"])).toThrow(/Uso:/);
    expect(() => parseDepositsArgs(["paid", "doce"])).toThrow(/Id no válido/);
  });

  it("expire no lleva argumentos", () => {
    expect(parseDepositsArgs(["expire"])).toEqual({ command: "expire" });
    expect(() => parseDepositsArgs(["expire", "1"])).toThrow(/Uso:/);
  });

  it("un comando desconocido o ninguno muestra el uso", () => {
    expect(() => parseDepositsArgs([])).toThrow(/Uso:/);
    expect(() => parseDepositsArgs(["borrar"])).toThrow(/Uso:/);
    expect(() => parseDepositsArgs(["list", "--todo"])).toThrow(/Opción desconocida/);
  });
});

import { describe, expect, it } from "vitest";
import { decodeParameters, encodeParameters, orderKey, sign, signaturesMatch } from "./signature";

// Valores de referencia de una librería pública de Redsys (go-redsys-api, sacados del ejemplo de Redsys)
const KEY = "Mk9m98IfEblmPfrpsawt7BmxObt98Jev";
const EXAMPLE = {
  DS_MERCHANT_AMOUNT: "145",
  DS_MERCHANT_ORDER: "1",
  DS_MERCHANT_MERCHANTCODE: "999008881",
  DS_MERCHANT_CURRENCY: "978",
  DS_MERCHANT_TRANSACTIONTYPE: "0",
  DS_MERCHANT_TERMINAL: "871",
  DS_MERCHANT_MERCHANTURL: "",
  DS_MERCHANT_URLOK: "",
  DS_MERCHANT_URLKO: "",
};

describe("firma de Redsys", () => {
  it("la clave del pedido es el pedido cifrado con 3DES", () => {
    expect(orderKey(KEY, "1").toString("base64")).toBe("Lr6bLJYWKrk=");
  });

  it("firma igual que la referencia", () => {
    const params = encodeParameters(EXAMPLE);
    expect(params.startsWith("eyJEU19NRVJDSEFOVF9BTU9VTlQiOiIxNDUi")).toBe(true);
    expect(sign(params, "1", KEY)).toBe("3TEI5WyvHf1D/whByt1ENgFH/HPIP9UFuB6LkCYgj+E=");
  });

  it("acepta la firma en Base64 para URL (como la manda Redsys) y rechaza otra", () => {
    const sig = sign(encodeParameters(EXAMPLE), "1", KEY);
    const urlSafe = sig.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(signaturesMatch(urlSafe, sig)).toBe(true);
    expect(signaturesMatch(sig, sig)).toBe(true);
    expect(signaturesMatch(sign(encodeParameters(EXAMPLE), "2", KEY), sig)).toBe(false);
    expect(signaturesMatch("", sig)).toBe(false);
  });

  it("una clave que no ocupa 24 bytes es un error", () => {
    expect(() => orderKey("abcd", "1")).toThrow(/24 bytes/);
  });
});

describe("decodeParameters", () => {
  it("devuelve los valores decodificados para URL", () => {
    const params = Buffer.from(JSON.stringify({ Ds_Date: "19%2F11%2F2026", Ds_Hour: "10%3A05", Ds_Amount: "1500" })).toString("base64");
    expect(decodeParameters(params)).toEqual({ Ds_Date: "19/11/2026", Ds_Hour: "10:05", Ds_Amount: "1500" });
  });

  it("acepta Base64 para URL", () => {
    const json = JSON.stringify({ Ds_MerchantData: "¿ok?>>" });
    const urlSafe = Buffer.from(json).toString("base64url");
    expect(decodeParameters(urlSafe)).toEqual({ Ds_MerchantData: "¿ok?>>" });
  });

  it("lo que no es JSON en Base64 es un error", () => {
    expect(() => decodeParameters("no-es-json")).toThrow();
    expect(() => decodeParameters(Buffer.from("[1]").toString("base64"))).toThrow(/objeto/);
  });
});
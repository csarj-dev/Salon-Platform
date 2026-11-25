import { describe, expect, it } from "vitest";
import {
  ORDER_CODE, REDSYS_PAYMENT_URL, REDSYS_TEST_MERCHANT, buildPaymentForm, isAuthorized, newOrderCode,
  readNotification, redsysCredentials, redsysEnvironment, type RedsysCredentials,
} from "./gateway";
import { SIGNATURE_VERSION, decodeParameters, encodeParameters, sign } from "./signature";

const TPV = { merchantCode: "123456789", terminal: 2, keyEnv: "REDSYS_KEY_LUZ" };
const test: RedsysCredentials = { environment: "test", ...REDSYS_TEST_MERCHANT };

describe("redsysEnvironment", () => {
  it("por defecto, pruebas; el real hay que pedirlo", () => {
    expect(redsysEnvironment({})).toBe("test");
    expect(redsysEnvironment({ REDSYS_ENVIRONMENT: " " })).toBe("test");
    expect(redsysEnvironment({ REDSYS_ENVIRONMENT: "test" })).toBe("test");
    expect(redsysEnvironment({ REDSYS_ENVIRONMENT: "live" })).toBe("live");
    expect(() => redsysEnvironment({ REDSYS_ENVIRONMENT: "produccion" })).toThrow(/test.*live/);
  });
});

describe("redsysCredentials", () => {
  it("en pruebas, siempre el comercio de pruebas de Redsys", () => {
    expect(redsysCredentials("test", null, {})).toEqual({ ok: true, credentials: test });
    expect(redsysCredentials("test", TPV, { REDSYS_KEY_LUZ: "x" })).toEqual({ ok: true, credentials: test });
  });

  it("en real, el TPV del cobrador con la clave de su variable", () => {
    expect(redsysCredentials("live", null, {})).toEqual({ ok: false, reason: "no_tpv" });
    expect(redsysCredentials("live", TPV, {})).toEqual({ ok: false, reason: "no_key" });
    expect(redsysCredentials("live", TPV, { REDSYS_KEY_LUZ: " clave " })).toEqual({
      ok: true,
      credentials: { environment: "live", merchantCode: "123456789", terminal: 2, key: "clave" },
    });
  });
});

describe("newOrderCode", () => {
  it("4 cifras y 8 letras o cifras", () => {
    for (let i = 0; i < 50; i++) expect(newOrderCode()).toMatch(ORDER_CODE);
    expect(newOrderCode(() => 0)).toBe("000000000000");
    expect(newOrderCode((max) => max - 1)).toBe("9999zzzzzzzz");
  });
});

describe("buildPaymentForm", () => {
  const req = {
    credentials: test,
    order: "1234AbCd5678",
    amountCents: 1500,
    notifyUrl: "https://salon.example.com/api/payments/redsys/notify",
    okUrl: "https://salon.example.com/es/booking/paid?t=1",
    koUrl: "https://salon.example.com/es/booking/not-paid?t=1",
    locale: "en",
    description: "Depósito · Laminado de cejas",
    merchantName: "The Room Studio con un nombre muy largo",
  };

  it("lleva los datos del pago firmados", () => {
    const form = buildPaymentForm(req);
    expect(form.action).toBe(REDSYS_PAYMENT_URL.test);
    expect(form.fields.Ds_SignatureVersion).toBe(SIGNATURE_VERSION);
    expect(decodeParameters(form.fields.Ds_MerchantParameters)).toEqual({
      DS_MERCHANT_AMOUNT: "1500",
      DS_MERCHANT_ORDER: "1234AbCd5678",
      DS_MERCHANT_MERCHANTCODE: "999008881",
      DS_MERCHANT_CURRENCY: "978",
      DS_MERCHANT_TRANSACTIONTYPE: "0",
      DS_MERCHANT_TERMINAL: "1",
      DS_MERCHANT_MERCHANTURL: req.notifyUrl,
      DS_MERCHANT_URLOK: req.okUrl,
      DS_MERCHANT_URLKO: req.koUrl,
      DS_MERCHANT_CONSUMERLANGUAGE: "002",
      DS_MERCHANT_PRODUCTDESCRIPTION: "Depósito · Laminado de cejas",
      DS_MERCHANT_MERCHANTNAME: "The Room Studio con un no", // 25 como máximo
    });
    expect(form.fields.Ds_Signature).toBe(sign(form.fields.Ds_MerchantParameters, req.order, test.key));
  });

  it("un idioma que Redsys no tiene: español", () => {
    const form = buildPaymentForm({ ...req, locale: "ja" });
    expect(decodeParameters(form.fields.Ds_MerchantParameters).DS_MERCHANT_CONSUMERLANGUAGE).toBe("001");
  });

  it("no firma un pedido o un importe que no valen", () => {
    expect(() => buildPaymentForm({ ...req, order: "12" })).toThrow(/pedido/);
    expect(() => buildPaymentForm({ ...req, amountCents: 0 })).toThrow(/Importe/);
    expect(() => buildPaymentForm({ ...req, amountCents: 15.5 })).toThrow(/Importe/);
  });

  it("en real, la página de pago real", () => {
    const live: RedsysCredentials = { environment: "live", merchantCode: "123456789", terminal: 2, key: test.key };
    expect(buildPaymentForm({ ...req, credentials: live }).action).toBe(REDSYS_PAYMENT_URL.live);
  });
});

describe("readNotification", () => {
  const params = {
    Ds_Date: "19%2F11%2F2026",
    Ds_Hour: "10%3A05",
    Ds_Amount: "1500",
    Ds_Currency: "978",
    Ds_Order: "1234AbCd5678",
    Ds_MerchantCode: "999008881",
    Ds_Terminal: "001",
    Ds_Response: "0000",
    Ds_AuthorisationCode: "123456",
    Ds_TransactionType: "0",
  };
  const form = (p: Record<string, string>, version = SIGNATURE_VERSION) => ({
    Ds_SignatureVersion: version,
    Ds_MerchantParameters: encodeParameters(p),
    Ds_Signature: "cualquiera",
  });

  it("lee el pedido, la respuesta, el importe y el comercio", () => {
    expect(readNotification(form(params))).toEqual({
      order: "1234AbCd5678",
      responseCode: 0,
      amountCents: 1500,
      merchantCode: "999008881",
      terminal: 1,
      authCode: "123456",
    });
  });

  it("los nombres pueden venir en mayúsculas", () => {
    const upper = Object.fromEntries(Object.entries(params).map(([k, v]) => [k.toUpperCase(), v]));
    expect(readNotification(form(upper))?.order).toBe("1234AbCd5678");
  });

  it("un pago denegado viene sin código de autorización", () => {
    const denied = readNotification(form({ ...params, Ds_Response: "0190", Ds_AuthorisationCode: "  " }));
    expect(denied).toMatchObject({ responseCode: 190, authCode: null });
  });

  it("lo que no es un aviso válido da null", () => {
    expect(readNotification(form(params, "HMAC_SHA512_V2"))).toBeNull();
    expect(readNotification({ ...form(params), Ds_Signature: null })).toBeNull();
    expect(readNotification({ ...form(params), Ds_MerchantParameters: "basura" })).toBeNull();
    expect(readNotification(form({ ...params, Ds_Order: "" }))).toBeNull();
    expect(readNotification(form({ ...params, Ds_Response: "ok" }))).toBeNull();
  });
});

describe("isAuthorized", () => {
  it("de 0000 a 0099, pagado", () => {
    expect([0, 1, 99].map(isAuthorized)).toEqual([true, true, true]);
    expect([100, 190, 9915, -1, 1.5].map(isAuthorized)).toEqual([false, false, false, false, false]);
  });
});
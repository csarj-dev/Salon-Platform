// Pago con tarjeta por Redsys (TPV virtual de BBVA), conexión por redirección:
// la web manda a la clienta a la página de pago de Redsys con un formulario firmado; Redsys avisa
// del resultado a nuestra ruta (/api/payments/redsys/notify) y devuelve a la clienta a la web.
// Aquí solo va lo que no toca la base de datos: entorno, credenciales, formulario y aviso.
import { randomInt } from "node:crypto";
import { SIGNATURE_VERSION, decodeParameters, encodeParameters, sign, signaturesMatch } from "./signature";

// "test": el entorno de pruebas público de Redsys, con su comercio y su clave de pruebas
//         (vale para todos los cobradores; no se mueve dinero de verdad).
// "live": el real, con el TPV de cada cobrador (payments.collectors.<id>.redsys).
export const REDSYS_ENVIRONMENTS = ["test", "live"] as const;
export type RedsysEnvironment = (typeof REDSYS_ENVIRONMENTS)[number];

// Por defecto, pruebas: el real hay que pedirlo a propósito con REDSYS_ENVIRONMENT=live
export function redsysEnvironment(env: Record<string, string | undefined> = process.env): RedsysEnvironment {
  const raw = env.REDSYS_ENVIRONMENT?.trim();
  if (!raw || raw === "test") return "test";
  if (raw === "live") return "live";
  throw new Error(`REDSYS_ENVIRONMENT tiene que ser "test" o "live" (recibido: "${raw}")`);
}

// Página de pago de Redsys
export const REDSYS_PAYMENT_URL: Record<RedsysEnvironment, string> = {
  test: "https://sis-t.redsys.es:25443/sis/realizarPago",
  live: "https://sis.redsys.es/sis/realizarPago",
};

// Datos públicos del entorno de pruebas (vienen en el manual de Redsys; no son secretos)
export const REDSYS_TEST_MERCHANT = {
  merchantCode: "999008881",
  terminal: 1,
  key: "sq7HjrUOBfKmC576ILgskD5srU870gJ7",
} as const;

// TPV real de un cobrador (del config). La clave nunca va en el config: `keyEnv` dice en qué
// variable de entorno está.
export type RedsysTpv = { merchantCode: string; terminal: number; keyEnv: string };

export type RedsysCredentials = {
  environment: RedsysEnvironment;
  merchantCode: string;
  terminal: number;
  key: string; // clave del comercio en Base64 (secreta en "live")
};

export type CredentialsResult =
  | { ok: true; credentials: RedsysCredentials }
  // no_tpv: el cobrador no tiene TPV en el config · no_key: falta su variable de entorno
  | { ok: false; reason: "no_tpv" | "no_key" };

// Con qué TPV se cobra a un cobrador en un entorno
export function redsysCredentials(
  environment: RedsysEnvironment,
  tpv: RedsysTpv | null,
  env: Record<string, string | undefined> = process.env,
): CredentialsResult {
  if (environment === "test") {
    return { ok: true, credentials: { environment, ...REDSYS_TEST_MERCHANT } };
  }
  if (!tpv) return { ok: false, reason: "no_tpv" };
  const key = env[tpv.keyEnv]?.trim();
  if (!key) return { ok: false, reason: "no_key" };
  return { ok: true, credentials: { environment, merchantCode: tpv.merchantCode, terminal: tpv.terminal, key } };
}

// Número de pedido: único para cada intento de pago (Redsys no admite repetirlo nunca, y el comercio
// de pruebas lo comparte todo el mundo). 12 caracteres: 4 cifras y 8 letras o cifras.
const ORDER_TAIL = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const ORDER_CODE = /^[0-9]{4}[0-9A-Za-z]{8}$/;

export function newOrderCode(random: (max: number) => number = randomInt): string {
  let s = "";
  for (let i = 0; i < 4; i++) s += String(random(10));
  for (let i = 0; i < 8; i++) s += ORDER_TAIL[random(ORDER_TAIL.length)];
  return s;
}

// Idioma de la página de pago (Ds_Merchant_ConsumerLanguage). Uno que no está: español.
const LANGUAGES: Record<string, string> = {
  es: "001", en: "002", ca: "003", fr: "004", de: "005", nl: "006", it: "007", sv: "008", pt: "009",
};

export type PaymentRequest = {
  credentials: RedsysCredentials;
  order: string;
  amountCents: number;
  notifyUrl: string; // adonde avisa Redsys (servidor a servidor)
  okUrl: string; // adonde vuelve la clienta si pagó
  koUrl: string; // adonde vuelve si no pagó o canceló
  locale: string;
  description?: string; // lo que ve la clienta en la página de pago ("Depósito · Laminado de cejas")
  merchantName?: string; // nombre del comercio en la página de pago
};

// Formulario que la web envía (POST) a Redsys
export type PaymentForm = {
  action: string;
  fields: { Ds_SignatureVersion: string; Ds_MerchantParameters: string; Ds_Signature: string };
};

export function buildPaymentForm(req: PaymentRequest): PaymentForm {
  if (!ORDER_CODE.test(req.order)) throw new Error(`Número de pedido no válido: ${req.order}`);
  if (!Number.isInteger(req.amountCents) || req.amountCents <= 0) {
    throw new Error(`Importe no válido: ${req.amountCents}`);
  }
  const params: Record<string, string> = {
    DS_MERCHANT_AMOUNT: String(req.amountCents),
    DS_MERCHANT_ORDER: req.order,
    DS_MERCHANT_MERCHANTCODE: req.credentials.merchantCode,
    DS_MERCHANT_CURRENCY: "978", // euros
    DS_MERCHANT_TRANSACTIONTYPE: "0", // pago normal
    DS_MERCHANT_TERMINAL: String(req.credentials.terminal),
    DS_MERCHANT_MERCHANTURL: req.notifyUrl,
    DS_MERCHANT_URLOK: req.okUrl,
    DS_MERCHANT_URLKO: req.koUrl,
    DS_MERCHANT_CONSUMERLANGUAGE: LANGUAGES[req.locale] ?? LANGUAGES.es,
  };
  if (req.description) params.DS_MERCHANT_PRODUCTDESCRIPTION = req.description.slice(0, 125);
  if (req.merchantName) params.DS_MERCHANT_MERCHANTNAME = req.merchantName.slice(0, 25);

  const merchantParameters = encodeParameters(params);
  return {
    action: REDSYS_PAYMENT_URL[req.credentials.environment],
    fields: {
      Ds_SignatureVersion: SIGNATURE_VERSION,
      Ds_MerchantParameters: merchantParameters,
      Ds_Signature: sign(merchantParameters, req.order, req.credentials.key),
    },
  };
}

// Lo que manda Redsys en su aviso (POST de formulario a /api/payments/redsys/notify)
export type NotificationForm = {
  Ds_SignatureVersion?: string | null;
  Ds_MerchantParameters?: string | null;
  Ds_Signature?: string | null;
};

export type RedsysNotification = {
  order: string;
  responseCode: number; // Ds_Response: 0–99 pagado; el resto, denegado o error
  amountCents: number;
  merchantCode: string;
  terminal: number;
  authCode: string | null;
};

// Lee los datos del aviso SIN comprobar la firma (para saber de qué pedido es y con qué clave
// comprobarla). Hay que llamar a signaturesMatch antes de fiarse de nada de lo que trae.
export function readNotification(form: NotificationForm): RedsysNotification | null {
  if (form.Ds_SignatureVersion !== SIGNATURE_VERSION || !form.Ds_MerchantParameters || !form.Ds_Signature) {
    return null;
  }
  let raw: Record<string, string>;
  try {
    raw = decodeParameters(form.Ds_MerchantParameters);
  } catch {
    return null;
  }
  // Redsys escribe los nombres a veces como Ds_Order y a veces como DS_ORDER
  const byName = new Map(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v.trim()]));
  const get = (name: string) => byName.get(name.toLowerCase()) ?? "";

  const order = get("Ds_Order");
  const responseCode = Number(get("Ds_Response"));
  const amountCents = Number(get("Ds_Amount"));
  const terminal = Number(get("Ds_Terminal"));
  if (!order || !/^\d+$/.test(get("Ds_Response")) || !Number.isInteger(amountCents) || !Number.isInteger(terminal)) {
    return null;
  }
  const authCode = get("Ds_AuthorisationCode");
  return {
    order,
    responseCode,
    amountCents,
    merchantCode: get("Ds_MerchantCode"),
    terminal,
    authCode: authCode ? authCode : null,
  };
}

// Ds_Response de 0000 a 0099: pago autorizado
export function isAuthorized(responseCode: number): boolean {
  return Number.isInteger(responseCode) && responseCode >= 0 && responseCode <= 99;
}

// ---- Devoluciones (API REST de Redsys, «trataPeticionREST») ----
// Se piden de servidor a servidor con el mismo pedido del pago y tipo de operación 3.
export const REDSYS_REST_URL: Record<RedsysEnvironment, string> = {
  test: "https://sis-t.redsys.es:25443/sis/rest/trataPeticionREST",
  live: "https://sis.redsys.es/sis/rest/trataPeticionREST",
};

// Ds_Response de una devolución aceptada
export const REFUND_ACCEPTED = 900;

export type RestRequest = { Ds_SignatureVersion: string; Ds_MerchantParameters: string; Ds_Signature: string };

// Petición de devolución de un pago (importe entero) firmada con la clave del comercio
export function buildRefundRequest(credentials: RedsysCredentials, order: string, amountCents: number): RestRequest {
  if (!ORDER_CODE.test(order)) throw new Error(`Número de pedido no válido: ${order}`);
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error(`Importe no válido: ${amountCents}`);
  const merchantParameters = encodeParameters({
    DS_MERCHANT_AMOUNT: String(amountCents),
    DS_MERCHANT_ORDER: order,
    DS_MERCHANT_MERCHANTCODE: credentials.merchantCode,
    DS_MERCHANT_CURRENCY: "978",
    DS_MERCHANT_TRANSACTIONTYPE: "3", // devolución
    DS_MERCHANT_TERMINAL: String(credentials.terminal),
  });
  return {
    Ds_SignatureVersion: SIGNATURE_VERSION,
    Ds_MerchantParameters: merchantParameters,
    Ds_Signature: sign(merchantParameters, order, credentials.key),
  };
}

export type RefundReply =
  | { ok: true; responseCode: number }
  // rejected: Redsys contestó, pero no la aceptó (Ds_Response distinto de 0900)
  | { ok: false; reason: "rejected"; responseCode: number }
  // error: Redsys devolvió un código de error (p. ej. SIS0057: importe mayor que lo pagado)
  | { ok: false; reason: "error"; code: string }
  // bad_reply: la respuesta no se entiende o su firma no cuadra
  | { ok: false; reason: "bad_reply" };

// Lee la respuesta de una devolución y comprueba su firma con la clave del comercio
export function readRefundReply(body: unknown, merchantKeyBase64: string): RefundReply {
  if (typeof body !== "object" || body === null) return { ok: false, reason: "bad_reply" };
  const reply = body as Record<string, unknown>;
  if (typeof reply.errorCode === "string" && reply.errorCode) return { ok: false, reason: "error", code: reply.errorCode };

  const params = reply.Ds_MerchantParameters;
  const signature = reply.Ds_Signature;
  if (reply.Ds_SignatureVersion !== SIGNATURE_VERSION || typeof params !== "string" || typeof signature !== "string") {
    return { ok: false, reason: "bad_reply" };
  }
  let data: Record<string, string>;
  try {
    data = decodeParameters(params);
  } catch {
    return { ok: false, reason: "bad_reply" };
  }
  const byName = new Map(Object.entries(data).map(([k, v]) => [k.toLowerCase(), v.trim()]));
  const order = byName.get("ds_order") ?? "";
  const response = byName.get("ds_response") ?? "";
  if (!order || !/^\d+$/.test(response)) return { ok: false, reason: "bad_reply" };
  if (!signaturesMatch(signature, sign(params, order, merchantKeyBase64))) return { ok: false, reason: "bad_reply" };

  const responseCode = Number(response);
  return responseCode === REFUND_ACCEPTED ? { ok: true, responseCode } : { ok: false, reason: "rejected", responseCode };
}
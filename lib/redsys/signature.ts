// Firma de Redsys (HMAC_SHA256_V1), la que usan el TPV virtual de BBVA y los demás bancos con Redsys.
// Cómo funciona (manual de Redsys, «Firma de las operaciones»):
//   1. Los datos de la operación van en un JSON pasado a Base64: Ds_MerchantParameters.
//   2. Con la clave del comercio (en Base64) se cifra el número de pedido con 3DES (CBC, IV de ceros,
//      relleno con ceros hasta múltiplo de 8): eso da una clave distinta para cada pedido.
//   3. La firma es el HMAC-SHA256 de Ds_MerchantParameters (el texto Base64 tal cual) con esa clave,
//      en Base64. Redsys manda la suya en Base64 «para URL» (- y _ en vez de + y /).
import { createCipheriv, createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_VERSION = "HMAC_SHA256_V1";

// Clave propia de un pedido: el pedido cifrado con 3DES usando la clave del comercio
export function orderKey(merchantKeyBase64: string, order: string): Buffer {
  const key = Buffer.from(merchantKeyBase64, "base64");
  if (key.length !== 24) throw new Error("La clave de Redsys debe ocupar 24 bytes (32 caracteres en Base64)");
  const data = Buffer.from(order, "utf8");
  const padded = Buffer.concat([data, Buffer.alloc((8 - (data.length % 8)) % 8)]);
  const cipher = createCipheriv("des-ede3-cbc", key, Buffer.alloc(8));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]);
}

// Firma (Base64 normal) de unos Ds_MerchantParameters para un pedido
export function sign(merchantParameters: string, order: string, merchantKeyBase64: string): string {
  return createHmac("sha256", orderKey(merchantKeyBase64, order)).update(merchantParameters).digest("base64");
}

// Base64 «para URL» → Base64 normal (con su relleno), para poder comparar firmas
function toStandardBase64(value: string): string {
  const s = value.trim().replace(/-/g, "+").replace(/_/g, "/");
  return s + "=".repeat((4 - (s.length % 4)) % 4);
}

// ¿Coinciden dos firmas? Admite las dos variantes de Base64 y compara en tiempo constante
export function signaturesMatch(received: string, expected: string): boolean {
  const a = Buffer.from(toStandardBase64(received), "base64");
  const b = Buffer.from(toStandardBase64(expected), "base64");
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

// Datos de la operación → Ds_MerchantParameters
export function encodeParameters(params: Record<string, string>): string {
  return Buffer.from(JSON.stringify(params), "utf8").toString("base64");
}

// Ds_MerchantParameters → datos. Redsys manda algunos valores codificados para URL
// (p. ej. Ds_Date "19%2F11%2F2026"): se devuelven ya decodificados.
export function decodeParameters(merchantParameters: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(toStandardBase64(merchantParameters), "base64").toString("utf8"));
  } catch {
    throw new Error("Ds_MerchantParameters no es un JSON en Base64");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Ds_MerchantParameters no es un objeto");
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (v === null || v === undefined) continue;
    const s = String(v);
    try {
      out[k] = decodeURIComponent(s.replace(/\+/g, " "));
    } catch {
      out[k] = s;
    }
  }
  return out;
}
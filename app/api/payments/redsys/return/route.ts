import { hasLocale } from "next-intl";
import { routing } from "@/i18n/routing";
import { runPaymentEffects } from "@/lib/card-payment";
import { applyRedsysNotification } from "@/lib/payments-db";
import { loadSalonConfig } from "@/lib/salon-config";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// La clienta vuelve aquí desde la página de pago de Redsys (Ds_Merchant_UrlOK / UrlKO) y se la
// lleva a la página de su cita. Redsys suele añadir a esta dirección los mismos datos firmados que
// manda en el aviso: si vienen, se aplican igual que el aviso (se comprueba la firma y no pasa nada
// si ya se había aplicado). Así la cita se confirma aunque el aviso tarde o no llegue (en local,
// sin túnel, Redsys no puede llamar a nuestro servidor).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("t") ?? "";
  const lang = url.searchParams.get("lang") ?? "";
  const result = url.searchParams.get("r") === "ok" ? "ok" : "ko";
  if (!UUID.test(token)) return Response.json({ error: "Cita no encontrada" }, { status: 404 });
  const locale = hasLocale(routing.locales, lang) ? lang : routing.defaultLocale;

  // Redsys pone el Base64 en la dirección sin codificar: un "+" llega aquí como espacio
  const signed = (name: string) => url.searchParams.get(name)?.replace(/ /g, "+") ?? null;
  const merchantParameters = signed("Ds_MerchantParameters");
  if (merchantParameters) {
    try {
      const config = await loadSalonConfig();
      const applied = await applyRedsysNotification(
        {
          Ds_SignatureVersion: url.searchParams.get("Ds_SignatureVersion"),
          Ds_MerchantParameters: merchantParameters,
          Ds_Signature: signed("Ds_Signature"),
        },
        config,
      );
      if (applied.ok) runPaymentEffects(applied, config);
      else console.error(`[redsys] datos de vuelta rechazados: ${applied.reason}`);
    } catch (error) {
      // La clienta llega a su página igualmente: allí ve si la cita quedó confirmada
      console.error("[redsys] return", error);
    }
  }

  return Response.redirect(new URL(`/${locale}/booking/confirmed/${token.toLowerCase()}?pay=${result}`, request.url), 303);
}
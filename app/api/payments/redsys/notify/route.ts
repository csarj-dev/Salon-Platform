import { runPaymentEffects } from "@/lib/card-payment";
import { applyRedsysNotification } from "@/lib/payments-db";
import { loadSalonConfig } from "@/lib/salon-config";

// Aviso de Redsys con el resultado de un pago (servidor a servidor, POST de formulario con
// Ds_SignatureVersion, Ds_MerchantParameters y Ds_Signature). La dirección se manda en cada pago
// (Ds_Merchant_MerchantUrl), así que no hay que configurarla en el TPV.
// Redsys da el aviso por entregado con un 200; se puede repetir sin miedo (lib/payments-db.ts).
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Formulario no válido" }, { status: 400 });
  }
  const field = (name: string) => {
    const v = form.get(name);
    return typeof v === "string" ? v : null;
  };

  try {
    const config = await loadSalonConfig();
    const result = await applyRedsysNotification(
      {
        Ds_SignatureVersion: field("Ds_SignatureVersion"),
        Ds_MerchantParameters: field("Ds_MerchantParameters"),
        Ds_Signature: field("Ds_Signature"),
      },
      config,
    );

    if (!result.ok) {
      console.error(`[redsys] aviso rechazado: ${result.reason}`);
      const status = result.reason === "unknown_order" ? 404 : result.reason === "no_key" ? 500 : 400;
      return Response.json({ error: result.reason }, { status });
    }
    runPaymentEffects(result, config);
    return Response.json({ ok: true, outcome: result.outcome });
  } catch (error) {
    console.error("[redsys] notify", error);
    return Response.json({ error: "Error al aplicar el aviso" }, { status: 500 });
  }
}
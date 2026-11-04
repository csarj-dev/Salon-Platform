import { isCronAuthorized } from "@/lib/cron-auth";
import { syncPendingKoibox } from "@/lib/koibox-sync";
import { loadSalonConfig } from "@/lib/salon-config";

// Pone Koibox al día: libera los depósitos vencidos y reintenta lo que no llegó.
// Lo llama el planificador cada 15 minutos, igual que el de recordatorios:
//   GET /api/cron/koibox   con la cabecera   Authorization: Bearer <CRON_SECRET>
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: "CRON_SECRET no está configurado" }, { status: 503 });
  }
  if (!isCronAuthorized(request.headers.get("authorization"), secret)) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const summary = await syncPendingKoibox(await loadSalonConfig());
    for (const f of summary.failed) console.error(`[cron] koibox cita ${f.id}: ${f.message}`);
    return Response.json(summary);
  } catch (error) {
    console.error("[cron] koibox", error);
    return Response.json({ error: "Error al sincronizar con Koibox" }, { status: 500 });
  }
}
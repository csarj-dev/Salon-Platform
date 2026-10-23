import { isCronAuthorized } from "@/lib/cron-auth";
import { sendDueReminders } from "@/lib/email/reminders";

// Lo llama un planificador (Vercel Cron, GitHub Actions, cron-job.org…) cada cierto tiempo:
//   GET /api/cron/reminders   con la cabecera   Authorization: Bearer <CRON_SECRET>
// Vercel añade esa cabecera solo si existe la variable de entorno CRON_SECRET.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: "CRON_SECRET no está configurado" }, { status: 503 });
  }
  if (!isCronAuthorized(request.headers.get("authorization"), secret)) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const summary = await sendDueReminders(new Date());
    return Response.json(summary);
  } catch (error) {
    console.error("[cron] reminders", error);
    return Response.json({ error: "Error al enviar los recordatorios" }, { status: 500 });
  }
}
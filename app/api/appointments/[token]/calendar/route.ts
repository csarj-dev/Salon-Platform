import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { getConfirmation } from "@/lib/appointment-view";
import { buildIcs } from "@/lib/ics";
import { loadSalonConfig } from "@/lib/salon-config";

// «Añadir al calendario» de la confirmación: descarga la cita como .ics.
// Se llega con el enlace secreto de la cita, igual que a su página.
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const url = new URL(request.url);
  const config = await loadSalonConfig();
  const lang = url.searchParams.get("lang");
  const locale = lang && hasLocale(routing.locales, lang) ? lang : config.defaultLocale;

  const now = new Date();
  const view = await getConfirmation(token, locale, config.defaultLocale, now);
  // Solo citas que siguen en pie (no anuladas ni caducadas)
  if (!view || (view.status !== "booked" && view.status !== "pending_deposit")) {
    return new Response("Not found", { status: 404 });
  }

  const t = await getTranslations({ locale, namespace: "Confirmation" });
  const ics = buildIcs({
    uid: `appointment-${view.id}@${url.host}`,
    now,
    start: view.startsAt,
    end: view.endsAt,
    summary: t("calendarTitle", { service: view.serviceName, salon: config.name }),
    location: [view.locationName, view.locationAddress].filter(Boolean).join(", "),
    description: t("calendarDescription", { staff: view.staffName, id: view.id }),
  });

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="appointment-${view.id}.ics"`,
      "Cache-Control": "no-store",
    },
  });
}
// Los servicios de cada cita, para enseñarlos en una sola línea ("Laminado de cejas + Diseño de cejas").
// Una consulta para todas las citas de una lista (no una por cita).
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { appointmentService, service, serviceTranslation } from "../db/schema";
import { pickTranslation } from "./pick-translation";

export const SERVICE_SEPARATOR = " + ";
export const joinServiceNames = (names: string[]) => names.join(SERVICE_SEPARATOR);

// Con idioma: el nombre traducido (lo que ve la clienta). Sin él: el nombre interno (el panel).
export type ServiceNamesLocale = { locale: string; defaultLocale: string };

// Nombres de los servicios de cada cita, en el orden en que se hacen.
// Una cita sin líneas no aparece en el mapa: quien llama se queda con su servicio principal.
export async function serviceNamesFor(
  appointmentIds: number[],
  lang?: ServiceNamesLocale,
): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  const ids = [...new Set(appointmentIds)];
  if (ids.length === 0) return out;

  const lines = await db
    .select({
      appointmentId: appointmentService.appointmentId,
      serviceId: appointmentService.serviceId,
      name: service.name,
    })
    .from(appointmentService)
    .innerJoin(service, eq(service.id, appointmentService.serviceId))
    .where(inArray(appointmentService.appointmentId, ids))
    .orderBy(asc(appointmentService.appointmentId), asc(appointmentService.position));

  const translations =
    lang && lines.length > 0
      ? await db
          .select()
          .from(serviceTranslation)
          .where(
            and(
              inArray(serviceTranslation.serviceId, [...new Set(lines.map((l) => l.serviceId))]),
              inArray(serviceTranslation.locale, [...new Set([lang.locale, lang.defaultLocale])]),
            ),
          )
      : [];

  for (const line of lines) {
    const name = lang
      ? pickTranslation(
          translations.filter((t) => t.serviceId === line.serviceId),
          lang.locale,
          lang.defaultLocale,
          line.name,
        ).name
      : line.name;
    const list = out.get(line.appointmentId) ?? [];
    list.push(name);
    out.set(line.appointmentId, list);
  }
  return out;
}

// Para una lista de filas que ya traen `serviceName` (el del servicio principal): lo cambia por
// todos los servicios de la cita, unidos. Las citas sin líneas se quedan como estaban.
export async function withServiceNames<T extends { id: number; serviceName: string }>(
  rows: T[],
  lang?: ServiceNamesLocale,
): Promise<T[]> {
  const names = await serviceNamesFor(rows.map((r) => r.id), lang);
  return rows.map((r) => {
    const list = names.get(r.id);
    return list ? { ...r, serviceName: joinServiceNames(list) } : r;
  });
}
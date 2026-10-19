import { z } from "zod";
import { DateTime } from "luxon";
import type { AvailabilityOptions } from "./availability-db";

const timezone = z.string().refine(
  (zone) => DateTime.local().setZone(zone).isValid,
  { message: "Zona horaria IANA no válida (ejemplo: Europe/Madrid)" },
);

const initialLocation = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  phone: z.string().optional(),
});

export const salonConfigSchema = z.object({
  name: z.string().min(1),
  timezone,
  locales: z.array(z.string()).min(1),
  defaultLocale: z.string(),
  // Solo se usa en el alta del salón; después los locales se gestionan en la base de datos
  initialLocations: z.array(initialLocation).default([]),
  booking: z.object({
    slotStepMin: z.number().int().positive().default(30),
    bufferMin: z.number().int().min(0).default(0),
    minNoticeHours: z.number().min(0).default(2),
    maxDaysAhead: z.number().int().positive().default(60),
  }),
});

export type SalonConfig = z.infer<typeof salonConfigSchema>;

// Lee SALON_ID del entorno, carga salons/<id>/config.ts y lo valida
export async function loadSalonConfig(): Promise<SalonConfig> {
  const id = process.env.SALON_ID;
  if (!id) throw new Error("Falta SALON_ID en el entorno");
  const mod = await import(`../salons/${id}/config`);
  return salonConfigSchema.parse(mod.default);
}

// Traduce la configuración del salón a las opciones del cálculo de huecos
export function toAvailabilityOptions(c: SalonConfig): AvailabilityOptions {
  return {
    zone: c.timezone,
    stepMin: c.booking.slotStepMin,
    bufferMin: c.booking.bufferMin,
    minNoticeHours: c.booking.minNoticeHours,
  };
}
import { z } from "zod";
import { IANAZone } from "luxon";
import type { AvailabilityOptions } from "./availability-db";

const timezone = z.string().refine(
  (zone) => IANAZone.isValidZone(zone),
  { message: "Zona horaria IANA no válida (ejemplo: Europe/Madrid)" },
);

const initialLocation = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  phone: z.string().optional(),
});

const hex = (fallback: string) =>
  z
    .string()
    .regex(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i, "Color en hexadecimal, por ejemplo #1a1a1a")
    .default(fallback);

// Tema neutro por defecto; cada salón sobrescribe lo que quiera
const themeSchema = z.object({
  background: hex("#ffffff"),
  foreground: hex("#171717"),
  surface: hex("#ffffff"),
  primary: hex("#171717"),
  primaryForeground: hex("#fafafa"),
  secondary: hex("#f5f5f5"),
  secondaryForeground: hex("#171717"),
  muted: hex("#f5f5f5"),
  mutedForeground: hex("#737373"),
  border: hex("#e5e5e5"),
  radius: z
    .string()
    .regex(/^\d+(\.\d+)?(rem|px)$/, "Ejemplo: 0.5rem")
    .default("0.5rem"),
});

const brandingSchema = z.object({
  logoText: z.string().optional(), // si falta, se usa el nombre del salón
  logo: z.string().optional(),     // ruta dentro de /public, p. ej. /salons/the-room/logo.png
});

export const salonConfigSchema = z.object({
  name: z.string().min(1),
  timezone,
  locales: z.array(z.string()).min(1),
  defaultLocale: z.string(),
  branding: brandingSchema.optional(),
  theme: themeSchema.optional().transform((v) => themeSchema.parse(v ?? {})),
  // Solo se usa en el alta del salón; después los locales se gestionan en la base de datos
  initialLocations: z.array(initialLocation).default([]),
  booking: z.object({
    slotStepMin: z.number().int().positive().default(30),
    bufferMin: z.number().int().min(0).default(0),
    minNoticeHours: z.number().min(0).default(2),
    maxDaysAhead: z.number().int().positive().default(60),
    cancellationNoticeHours: z.number().min(0).default(24),
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
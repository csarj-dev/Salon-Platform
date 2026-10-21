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
  logoText: z.string().optional(),
  logo: z.string().optional(),
  logoWidth: z.number().int().positive().optional(),
  logoHeight: z.number().int().positive().optional(),
});

// WhatsApp en formato internacional: se admiten espacios, "+" y guiones al
// escribirlo, y se guarda solo con dígitos (34600000000), que es lo que pide wa.me
const whatsapp = z
  .string()
  .transform((v) => v.replace(/[\s+()-]/g, ""))
  .refine((v) => /^\d{8,15}$/.test(v), {
    message: "WhatsApp con prefijo de país y solo números, por ejemplo 34600000000",
  });

const contactSchema = z.object({
  whatsapp: whatsapp.optional(),
  email: z.email().optional(),
  instagram: z.string().min(1).optional(), // solo el usuario, sin @ ni URL
});

// Una foto de la galería. Sin `src` se pinta un bloque gris (marcador de posición)
const galleryItemSchema = z.object({
  src: z.string().min(1).optional(), // ruta dentro de /public
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  alt: z.record(z.string(), z.string()), // texto alternativo por idioma
});

// Portada. Sin `src` se pinta un bloque gris (marcador de posición)
const heroSchema = z.object({
  src: z.string().min(1).optional(), // ruta dentro de /public o URL del bucket
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  // Punto de enfoque del recorte, p. ej. "center 15%". Sin esto, el recorte es centrado.
  // Solo se admiten valores de object-position (no CSS libre).
  focus: z
    .string()
    .regex(
      /^(left|center|right|\d{1,3}%) (top|center|bottom|\d{1,3}%)$/,
      'Dos valores, por ejemplo "center 15%" o "left top"',
    )
    .optional(),
      // Imagen alternativa para pantallas de móvil (menos de 768 px), p. ej. un encuadre vertical.
  // Sin esto, se usa la misma imagen en todas las pantallas.
  mobile: z
    .object({
      src: z.string().min(1),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .optional(),
  alt: z.record(z.string(), z.string()), // texto alternativo por idioma
});

export const salonConfigSchema = z
  .object({
    name: z.string().min(1),
    timezone,
    locales: z.array(z.string()).min(1),
    defaultLocale: z.string(),
    currency: z.string().length(3).default("EUR"),
    branding: brandingSchema.optional(),
    theme: themeSchema.optional().transform((v) => themeSchema.parse(v ?? {})),
    contact: contactSchema.default({}),
    gallery: z.array(galleryItemSchema).default([]),
    hero: heroSchema.optional(),
    // Solo se usa en el alta del salón; después los locales se gestionan en la base de datos
    initialLocations: z.array(initialLocation).default([]),
    booking: z.object({
      // Canales por los que se puede reservar; vacío = solo carta informativa
      channels: z.array(z.enum(["online", "whatsapp"])).default(["online"]),
      slotStepMin: z.number().int().positive().default(30),
      bufferMin: z.number().int().min(0).default(0),
      minNoticeHours: z.number().min(0).default(2),
      maxDaysAhead: z.number().int().positive().default(60),
      cancellationNoticeHours: z.number().min(0).default(24),
    }),
  })
  .superRefine((c, ctx) => {
    // Un canal de WhatsApp sin número no tiene sentido
    if (c.booking.channels.includes("whatsapp") && !c.contact.whatsapp) {
      ctx.addIssue({
        code: "custom",
        path: ["contact", "whatsapp"],
        message: 'El canal "whatsapp" está activo pero falta contact.whatsapp (o SALON_WHATSAPP)',
      });
    }

    // Accesibilidad: toda foto necesita texto alternativo en todos los idiomas del salón
    c.gallery.forEach((item, i) => {
      for (const locale of c.locales) {
        if (!item.alt[locale]?.trim()) {
          ctx.addIssue({
            code: "custom",
            path: ["gallery", i, "alt", locale],
            message: `Falta el texto alternativo en "${locale}"`,
          });
        }
      }
    });

    if (c.hero) {
      for (const locale of c.locales) {
        if (!c.hero.alt[locale]?.trim()) {
          ctx.addIssue({
            code: "custom",
            path: ["hero", "alt", locale],
            message: `Falta el texto alternativo de la portada en "${locale}"`,
          });
        }
      }
    }
  });

export type SalonConfig = z.infer<typeof salonConfigSchema>;
export type GalleryItem = SalonConfig["gallery"][number];
export type HeroConfig = NonNullable<SalonConfig["hero"]>;

// Variables de entorno que pisan valores del archivo de config.
// Hoy solo SALON_WHATSAPP; así un número personal de pruebas no se sube al repo.
export function applyEnvOverrides(
  raw: Record<string, unknown>,
  env: Record<string, string | undefined>,
): Record<string, unknown> {
  const whatsapp = env.SALON_WHATSAPP?.trim();
  if (!whatsapp) return raw;
  const contact = (raw.contact ?? {}) as Record<string, unknown>;
  return { ...raw, contact: { ...contact, whatsapp } };
}

// Lee SALON_ID del entorno, carga salons/<id>/config.ts y lo valida
export async function loadSalonConfig(): Promise<SalonConfig> {
  const id = process.env.SALON_ID;
  if (!id) throw new Error("Falta SALON_ID en el entorno");
  const mod = await import(`../salons/${id}/config`);
  const raw = applyEnvOverrides(mod.default as Record<string, unknown>, process.env);
  return salonConfigSchema.parse(raw);
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
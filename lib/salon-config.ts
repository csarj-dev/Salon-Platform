import { z } from "zod";
import { IANAZone } from "luxon";
import type { AvailabilityOptions } from "./availability-db";
import { DEPOSIT_MODES } from "./deposit";

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

// Texto por idioma (instrucciones de pago, política de cancelación...)
const localizedText = z.record(z.string(), z.string());

// Depósitos: el importe va en cada servicio (base de datos); esto es lo común a todo el salón
const depositSchema = z.object({
    // Cómo se paga: con instrucciones (Bizum, transferencia) o pidiendo un enlace de cobro por WhatsApp
  mode: z.enum(DEPOSIT_MODES).default("instructions"),
  // Horas que se guarda el hueco esperando el pago
  holdHours: z.number().positive().default(24),
  // Cómo pagar (Bizum, transferencia...), por idioma
  instructions: localizedText.optional(),
  // Política de cancelación y devolución del depósito, por idioma
  policy: localizedText.optional(),
});

// Cuentas de Koibox del salón. Cada cuenta es un centro de Koibox con su propia clave;
// la clave nunca va aquí: `keyEnv` dice en qué variable de entorno está (en Vercel).
export const KOIBOX_ACCOUNT_ID = /^[a-z][a-z0-9_-]{0,31}$/;

const koiboxAccountSchema = z.object({
  label: z.string().min(1), // "Cuenta del salón", "Cuenta de Amanda"...
  keyEnv: z
    .string()
    .regex(/^KOIBOX_KEY_[A-Z0-9_]+$/, "Nombre de variable tipo KOIBOX_KEY_SALON"),
  // Locales (por su slug) donde trabaja esta cuenta. Sin esto, vale para todos los locales.
  locations: z
    .array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug del local, por ejemplo the-room-studio"))
    .min(1)
    .optional(),
});

// De dónde salen los huecos de la reserva web:
// "local": turnos, citas y ausencias de nuestra base de datos (como hasta ahora).
// "koibox": horarios, citas y bloqueos de las cuentas de Koibox del salón.
export const AVAILABILITY_SOURCES = ["local", "koibox"] as const;
export type AvailabilitySource = (typeof AVAILABILITY_SOURCES)[number];

const koiboxSchema = z.object({
  accounts: z
    .record(
      z.string().regex(KOIBOX_ACCOUNT_ID, "Id de cuenta en minúsculas, por ejemplo salon o amanda"),
      koiboxAccountSchema,
    )
    .default({}),
});

export const salonConfigSchema = z
  .object({
    name: z.string().min(1),
    timezone,
    locales: z.array(z.string()).min(1),
    defaultLocale: z.string(),
    currency: z.string().length(3).default("EUR"),
    // Prefijo telefónico del país del salón (sin "+"): completa los teléfonos sin prefijo
    phoneCountryCode: z
      .string()
      .regex(/^\d{1,3}$/, "Prefijo sin +, por ejemplo 34")
      .default("34"),
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
      deposit: depositSchema.prefault({}),
      availability: z.enum(AVAILABILITY_SOURCES).default("local"),
    }),
    // Sin `koibox` (o sin cuentas) el salón no usa Koibox
    koibox: koiboxSchema.prefault({}),
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

    // Pedir el enlace de pago por WhatsApp exige un número al que escribir
    if (c.booking.deposit.mode === "whatsapp" && !c.contact.whatsapp) {
      ctx.addIssue({
        code: "custom",
        path: ["booking", "deposit", "mode"],
        message: 'El depósito se paga por "whatsapp" pero falta contact.whatsapp (o SALON_WHATSAPP)',
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

    // Los textos del depósito, si existen, tienen que estar en todos los idiomas del salón
    for (const field of ["instructions", "policy"] as const) {
      const texts = c.booking.deposit[field];
      if (!texts) continue;
      for (const locale of c.locales) {
        if (!texts[locale]?.trim()) {
          ctx.addIssue({
            code: "custom",
            path: ["booking", "deposit", field, locale],
            message: `Falta el texto en "${locale}"`,
          });
        }
      }
    }

    // Sacar los huecos de Koibox sin ninguna cuenta no tiene sentido
    if (c.booking.availability === "koibox" && Object.keys(c.koibox.accounts).length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["booking", "availability"],
        message: 'Los huecos vienen de "koibox" pero no hay cuentas en koibox.accounts',
      });
    }

    // Dos cuentas con la misma clave serían el mismo centro de Koibox
    const keyOwners = new Map<string, string>();
    for (const [id, account] of Object.entries(c.koibox.accounts)) {
      const other = keyOwners.get(account.keyEnv);
      if (other) {
        ctx.addIssue({
          code: "custom",
          path: ["koibox", "accounts", id, "keyEnv"],
          message: `La variable ${account.keyEnv} ya la usa la cuenta "${other}"`,
        });
      }
      keyOwners.set(account.keyEnv, id);
    }

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
export type KoiboxConfig = SalonConfig["koibox"];

// Variables de entorno que pisan valores del archivo de config:
// - SALON_WHATSAPP: así un número personal de pruebas no se sube al repo.
// - BOOKING_AVAILABILITY ("local" o "koibox"): para probar el modo Koibox en local sin tocar el config.
export function applyEnvOverrides(
  raw: Record<string, unknown>,
  env: Record<string, string | undefined>,
): Record<string, unknown> {
  let out = raw;
  const whatsapp = env.SALON_WHATSAPP?.trim();
  if (whatsapp) {
    const contact = (out.contact ?? {}) as Record<string, unknown>;
    out = { ...out, contact: { ...contact, whatsapp } };
  }
  const availability = env.BOOKING_AVAILABILITY?.trim();
  if (availability) {
    const booking = (out.booking ?? {}) as Record<string, unknown>;
    out = { ...out, booking: { ...booking, availability } };
  }
  return out;
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
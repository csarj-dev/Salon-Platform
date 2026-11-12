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

const hexColor = z
  .string()
  .regex(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i, "Color en hexadecimal, por ejemplo #1a1a1a");
const hex = (fallback: string) => hexColor.default(fallback);

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
  // Estados en el panel (al día / pendiente / error): texto, puntos y fondos suaves.
  // danger es también el rojo de los errores y de "Cancelar" en toda la web.
  success: hex("#2f7d4a"),
  warning: hex("#a16207"),
  danger: hex("#b42318"),
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

// Depósitos: el importe va en cada servicio (base de datos); esto es lo común a todo el salón.
// Cómo se paga (modo, WhatsApp, instrucciones) va en cada cobrador: payments.collectors.
const movedToCollectors = 'Se movió a payments.collectors: cada cobrador lleva su "deposit" (ver docs/collectors.md)';
const depositSchema = z.object({
  // Horas que se guarda el hueco esperando el pago
  holdHours: z.number().positive().default(24),
  // Política de cancelación y devolución del depósito, por idioma
  policy: localizedText.optional(),
  // Antes estaban aquí: si un config viejo los trae, error claro en vez de ignorarlos sin avisar
  mode: z.never({ error: movedToCollectors }).optional(),
  instructions: z.never({ error: movedToCollectors }).optional(),
});

// Cobradores: quién recibe el dinero de los depósitos y cómo se le paga. En un salón con varias
// titulares (cada una con su NIF) hay uno por titular; en un salón pequeño, uno solo.
// Qué cobrador toca en cada cita: lib/collectors.ts (y docs/collectors.md).
export const COLLECTOR_ID = /^[a-z][a-z0-9_-]{0,31}$/;
const collectorId = z.string().regex(COLLECTOR_ID, "Id de cobrador en minúsculas, por ejemplo salon o amanda");

const collectorSchema = z.object({
  label: z.string().min(1), // nombre que ve recepción ("The Room Studio", "Amanda")
  // Punto de color con el que se le reconoce en el panel (Cobros, Koibox). Opcional.
  color: hexColor.optional(),
  deposit: z
    .object({
      // Igual que en booking.deposit: con instrucciones (Bizum, transferencia) o pidiendo
      // por WhatsApp el enlace de cobro del TPV
      mode: z.enum(DEPOSIT_MODES).default("instructions"),
      // WhatsApp de esta titular para pedir el enlace. Sin esto, el del salón (contact.whatsapp)
      whatsapp: whatsapp.optional(),
      // Cómo pagarle, por idioma
      instructions: localizedText.optional(),
    })
    .prefault({}),
});

const paymentsSchema = z.object({
  // El que cobra cuando no se indica otro. Si solo hay uno, no hace falta ponerlo.
  defaultCollector: collectorId.optional(),
  // Sin cobradores, hay uno solo con lo de booking.deposit (como hasta ahora)
  collectors: z.record(collectorId, collectorSchema).default({}),
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
  // Quién cobra los depósitos de las citas de esta cuenta (un id de payments.collectors).
  // Sin esto, el cobrador por defecto.
  collector: collectorId.optional(),
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

// Correos que manda la web a la clienta. La confirmación y la cancelación salen siempre:
// llevan el enlace a su cita, que solo tiene nuestra web.
const emailSchema = z.object({
  // Recordatorio antes de la cita. Apagar si el salón ya lo manda desde Koibox,
  // para que la clienta no reciba dos.
  reminders: z.boolean().default(true),
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
      // Qué puede hacer la clienta con su cita desde el enlace del correo (siempre fuera del
      // plazo de cancelación; una cita que espera el depósito se puede cancelar siempre).
      // Apagado: tiene que escribir al salón.
      clientChanges: z
        .object({
          cancel: z.boolean().default(true),
          reschedule: z.boolean().default(true),
        })
        .prefault({}),
      deposit: depositSchema.prefault({}),
      availability: z.enum(AVAILABILITY_SOURCES).default("local"),
    }),
    // Sin `koibox` (o sin cuentas) el salón no usa Koibox
    koibox: koiboxSchema.prefault({}),
    email: emailSchema.prefault({}),
    payments: paymentsSchema.prefault({}),
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

    // La política del depósito, si existe, en todos los idiomas del salón
    const policy = c.booking.deposit.policy;
    if (policy) {
      for (const locale of c.locales) {
        if (!policy[locale]?.trim()) {
          ctx.addIssue({
            code: "custom",
            path: ["booking", "deposit", "policy", locale],
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

    // Cobradores: el de por defecto existe, cada cuenta apunta a uno que existe,
    // quien cobra por WhatsApp tiene número y las instrucciones están en todos los idiomas
    const collectorIds = Object.keys(c.payments.collectors);
    if (collectorIds.length > 0) {
      if (c.payments.defaultCollector === undefined && collectorIds.length > 1) {
        ctx.addIssue({
          code: "custom",
          path: ["payments", "defaultCollector"],
          message: `Con varios cobradores hay que decir cuál cobra por defecto (hay: ${collectorIds.join(", ")})`,
        });
      }
    }
    if (c.payments.defaultCollector !== undefined && !collectorIds.includes(c.payments.defaultCollector)) {
      ctx.addIssue({
        code: "custom",
        path: ["payments", "defaultCollector"],
        message: `El cobrador "${c.payments.defaultCollector}" no está en payments.collectors`,
      });
    }
    for (const [id, account] of Object.entries(c.koibox.accounts)) {
      if (account.collector !== undefined && !collectorIds.includes(account.collector)) {
        ctx.addIssue({
          code: "custom",
          path: ["koibox", "accounts", id, "collector"],
          message: `El cobrador "${account.collector}" no está en payments.collectors`,
        });
      }
    }
    for (const [id, collector] of Object.entries(c.payments.collectors)) {
      if (collector.deposit.mode === "whatsapp" && !collector.deposit.whatsapp && !c.contact.whatsapp) {
        ctx.addIssue({
          code: "custom",
          path: ["payments", "collectors", id, "deposit", "whatsapp"],
          message: `"${id}" cobra por WhatsApp pero no tiene número (ni hay contact.whatsapp)`,
        });
      }
      for (const locale of c.locales) {
        if (collector.deposit.instructions && !collector.deposit.instructions[locale]?.trim()) {
          ctx.addIssue({
            code: "custom",
            path: ["payments", "collectors", id, "deposit", "instructions", locale],
            message: `Falta el texto en "${locale}"`,
          });
        }
      }
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
import { z } from "zod";

// Quita espacios y guiones, y exige entre 9 y 15 dígitos con "+" opcional
const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^\+?\d{9,15}$/, "Teléfono no válido"));

const optionalEmail = z
  .union([z.literal(""), z.string().trim().email("Email no válido")])
  .optional()
  .transform((v) => (v ? v : undefined));

const requiredEmail = z.string().trim().email("Email no válido");

const clientBase = z.object({
  name: z.string().trim().min(2).max(100),
  phone,
});

// Datos de la clienta tal y como llegan del formulario web: el email es obligatorio
// porque es por donde se le manda la confirmación
export const clientFormSchema = clientBase.extend({ email: requiredEmail });

// Datos de la clienta al crear una cita: recepción o WhatsApp pueden no tener su email
const clientDataSchema = clientBase.extend({ email: optionalEmail });

export const bookingInputSchema = z
  .object({
    locationId: z.number().int().positive(),
    serviceId: z.number().int().positive(),
    staffId: z.number().int().positive(),
    startsAt: z.coerce.date(),
    source: z.enum(["web", "phone", "whatsapp"]).default("web"),
    client: clientDataSchema,
    // Idioma de la clienta (para sus correos)
    locale: z.string().min(2).max(10).optional(),
    consent: z.boolean().default(false),
  })
  .refine((d) => d.source !== "web" || d.consent, {
    message: "Hace falta aceptar la política de privacidad",
    path: ["consent"],
  });

export type BookingInput = z.infer<typeof bookingInputSchema>;
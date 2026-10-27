import {
  pgTable, pgEnum, integer, smallint, text, boolean, timestamp, time,
  primaryKey, check, uuid, index, uniqueIndex
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./auth-schema";

export const appointmentStatus = pgEnum("appointment_status", [
  "booked", "completed", "cancelled", "no_show",
  // Reservada por la web, a la espera de que se pague el depósito
  "pending_deposit",
  // El plazo para pagar el depósito venció: el hueco se liberó
  "expired",
]);
export const appointmentSource = pgEnum("appointment_source", [
  "web", "phone", "whatsapp",
]);

// Una foto es un archivo en el almacenamiento (la clave) más sus medidas.
// El texto alternativo vive aparte, uno por idioma y obligatorio.
export const photo = pgTable(
  "photo",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    storageKey: text("storage_key").notNull().unique(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("photo_size_positive", sql`${t.width} > 0 AND ${t.height} > 0`)],
);

export const photoTranslation = pgTable(
  "photo_translation",
  {
    photoId: integer("photo_id")
      .notNull()
      .references(() => photo.id, { onDelete: "cascade" }),
    locale: text("locale").notNull(),
    alt: text("alt").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.photoId, t.locale] }),
    check("photo_translation_alt_not_blank", sql`length(btrim(${t.alt})) > 0`),
  ],
);

export const location = pgTable("location", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  address: text("address"),
  phone: text("phone"),
  mapsUrl: text("maps_url"), // enlace "Cómo llegar",
  // Dirección web del local (/locations/<slug>). Opcional: sin slug no hay página propia.
  slug: text("slug").unique(),
  // Si se borra la foto, la entidad se queda sin foto (no se borra)
  photoId: integer("photo_id").references(() => photo.id, { onDelete: "set null" }),
  active: boolean("active").notNull().default(true),
});

// Horario de apertura al público de cada local (no el de las profesionales).
// Un día con turno partido = dos filas, igual que en `schedule`.
export const locationHours = pgTable(
  "location_hours",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    locationId: integer("location_id")
      .notNull()
      .references(() => location.id, { onDelete: "cascade" }),
    weekday: smallint("weekday").notNull(), // 1 = lunes ... 7 = domingo
    openTime: time("open_time").notNull(),
    closeTime: time("close_time").notNull(),
  },
  (t) => [
    check("location_hours_weekday_range", sql`${t.weekday} BETWEEN 1 AND 7`),
    check("location_hours_close_after_open", sql`${t.closeTime} > ${t.openTime}`),
  ],
);

// Galería de fotos de cada local, en orden. La foto de portada es `location.photoId`.
export const locationPhoto = pgTable(
  "location_photo",
  {
    locationId: integer("location_id")
      .notNull()
      .references(() => location.id, { onDelete: "cascade" }),
    photoId: integer("photo_id")
      .notNull()
      .references(() => photo.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.locationId, t.photoId] })],
);

// Categorías de la carta: Cejas, Pestañas, Micropigmentación...
export const serviceCategory = pgTable("service_category", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(), // nombre interno, de reserva
  sortOrder: integer("sort_order").notNull().default(0),
});

export const serviceCategoryTranslation = pgTable(
  "service_category_translation",
  {
    categoryId: integer("category_id")
      .notNull()
      .references(() => serviceCategory.id, { onDelete: "cascade" }),
    locale: text("locale").notNull(),
    name: text("name").notNull(),
  },
  (t) => [primaryKey({ columns: [t.categoryId, t.locale] })],
);

export const service = pgTable("service", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  durationMin: integer("duration_min").notNull(),
  priceCents: integer("price_cents").notNull(),
  // Si se borra la categoría, el servicio queda sin categoría (no se borra)
  categoryId: integer("category_id").references(() => serviceCategory.id, {
    onDelete: "set null",
  }),
  sortOrder: integer("sort_order").notNull().default(0),
  // true = se reserva hablando antes (no por la web)
  requiresConsultation: boolean("requires_consultation").notNull().default(false),
  // true = aparece en "Nuestros servicios" de la portada
  featured: boolean("featured").notNull().default(false),
  // Si se borra la foto, la entidad se queda sin foto (no se borra)
  photoId: integer("photo_id").references(() => photo.id, { onDelete: "set null" }),
  // Dirección web (/services/<slug>). Opcional: sin slug no hay página propia.
  slug: text("slug").unique(),
  // Depósito (en céntimos) que se pide al reservar por la web. Vacío = sin depósito.
  depositCents: integer("deposit_cents"),
},
(t) => [
  check(
    "service_deposit_positive",
    sql`${t.depositCents} IS NULL OR ${t.depositCents} > 0`,
  ),
]);

export const serviceTranslation = pgTable(
  "service_translation",
  {
    serviceId: integer("service_id")
      .notNull()
      .references(() => service.id, { onDelete: "cascade" }),
    locale: text("locale").notNull(), // "es", "en"...
    name: text("name").notNull(),
    description: text("description"),
    // Texto largo de la página del servicio (párrafos separados por una línea en blanco)
    longDescription: text("long_description"),
  },
  (t) => [primaryKey({ columns: [t.serviceId, t.locale] })],
);

// Galería de fotos de cada servicio, en orden. La foto principal es `service.photoId`.
export const servicePhoto = pgTable(
  "service_photo",
  {
    serviceId: integer("service_id")
      .notNull()
      .references(() => service.id, { onDelete: "cascade" }),
    photoId: integer("photo_id")
      .notNull()
      .references(() => photo.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.serviceId, t.photoId] })],
);

export const staff = pgTable("staff", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  // Si se borra la foto, la entidad se queda sin foto (no se borra)
  photoId: integer("photo_id").references(() => photo.id, { onDelete: "set null" }),
  // Cuándo se publicó en la página del equipo. Vacío = no se muestra (nadie aparece sin activarlo).
  listedOnTeamAt: timestamp("listed_on_team_at", { withTimezone: true }),
});

// Cargo y presentación de cada profesional, por idioma
export const staffTranslation = pgTable(
  "staff_translation",
  {
    staffId: integer("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    locale: text("locale").notNull(),
    role: text("role"), // "Micropigmentadora", "Estilista de cejas"...
    bio: text("bio"),
  },
  (t) => [primaryKey({ columns: [t.staffId, t.locale] })],
);

// Qué servicios ofrece cada local (precio propio opcional)
export const locationService = pgTable(
  "location_service",
  {
    locationId: integer("location_id").notNull().references(() => location.id),
    serviceId: integer("service_id").notNull().references(() => service.id),
    priceCents: integer("price_cents"), // vacío = usa el precio del servicio
  },
  (t) => [primaryKey({ columns: [t.locationId, t.serviceId] })],
);

// Qué servicios sabe hacer cada profesional
export const staffService = pgTable(
  "staff_service",
  {
    staffId: integer("staff_id").notNull().references(() => staff.id),
    serviceId: integer("service_id").notNull().references(() => service.id),
  },
  (t) => [primaryKey({ columns: [t.staffId, t.serviceId] })],
);

export const client = pgTable("client", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  email: text("email"),
  consentAt: timestamp("consent_at", { withTimezone: true }),
});

// Cada turno dice en qué local trabaja la profesional
export const schedule = pgTable(
  "schedule",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    staffId: integer("staff_id").notNull().references(() => staff.id),
    locationId: integer("location_id").notNull().references(() => location.id),
    weekday: smallint("weekday").notNull(), // 1 = lunes ... 7 = domingo
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
  },
  (t) => [
    check("weekday_range", sql`${t.weekday} BETWEEN 1 AND 7`),
    check("schedule_end_after_start", sql`${t.endTime} > ${t.startTime}`),
  ],
);

// Las ausencias afectan a la persona, esté donde esté
export const timeOff = pgTable(
  "time_off",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    staffId: integer("staff_id").notNull().references(() => staff.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    reason: text("reason"),
  },
  (t) => [check("time_off_ends_after_starts", sql`${t.endsAt} > ${t.startsAt}`)],
);

export const appointment = pgTable(
  "appointment",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    clientId: integer("client_id").notNull().references(() => client.id),
    // Nombre y email con que se hizo ESTA reserva. La ficha de clienta se identifica por
    // teléfono y puede tener otro nombre (otra persona con el mismo número, o un cambio):
    // mensajes y panel usan siempre los de la cita.
    clientName: text("client_name").notNull(),
    clientEmail: text("client_email"),
    serviceId: integer("service_id").notNull().references(() => service.id),
    staffId: integer("staff_id").notNull().references(() => staff.id),
    locationId: integer("location_id").notNull().references(() => location.id),
    performedByStaffId: integer("performed_by_staff_id").references(() => staff.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: appointmentStatus("status").notNull().default("booked"),
    priceAppliedCents: integer("price_applied_cents").notNull(),
    source: appointmentSource("source").notNull(),
    // Idioma en que reservó la clienta (para sus correos). null = sin dato: se usa el del salón.
    locale: text("locale"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    // Depósito pedido al reservar: copia del importe del servicio en ese momento
    depositCents: integer("deposit_cents"),
    // Hasta cuándo se guarda el hueco esperando el pago (solo citas pendientes)
    depositDueAt: timestamp("deposit_due_at", { withTimezone: true }),
    depositPaidAt: timestamp("deposit_paid_at", { withTimezone: true }),
    // Auditoría: quién del equipo validó el depósito / canceló la cita.
    // null = lo hizo la clienta, un script, o es anterior a esta auditoría.
    depositValidatedBy: text("deposit_validated_by").references(() => user.id, {
      onDelete: "set null",
    }),
    cancelledBy: text("cancelled_by").references(() => user.id, { onDelete: "set null" }),
    // Motivo opcional al cancelar (texto libre, corto)
    cancelReason: text("cancel_reason"),
    // Identificador secreto para la página de confirmación (/booking/confirmed/<token>)
    publicToken: uuid("public_token").notNull().defaultRandom().unique(),
  },
  (t) => [
    check("ends_after_starts", sql`${t.endsAt} > ${t.startsAt}`),
    check(
      "appointment_deposit_positive",
      sql`${t.depositCents} IS NULL OR ${t.depositCents} > 0`,
    ),
    check(
      "appointment_cancel_reason_length",
      sql`${t.cancelReason} IS NULL OR char_length(${t.cancelReason}) <= 300`,
    ),
    // Una cita pendiente de depósito siempre sabe cuánto y hasta cuándo
    check(
      "appointment_pending_has_deposit",
      sql`${t.status} <> 'pending_deposit' OR (${t.depositCents} IS NOT NULL AND ${t.depositDueAt} IS NOT NULL)`,
    ),
  ],
);

// Correos enviados a las clientas: qué se mandó, a quién y cómo fue
export const emailKind = pgEnum("email_kind", ["confirmation", "cancellation", "reminder"]);
export const emailStatus = pgEnum("email_status", ["pending", "sent", "failed"]);

export const emailLog = pgTable(
  "email_log",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    appointmentId: integer("appointment_id")
      .notNull()
      .references(() => appointment.id, { onDelete: "cascade" }),
    kind: emailKind("kind").notNull(),
    toEmail: text("to_email").notNull(),
    status: emailStatus("status").notNull().default("pending"),
    // Identificador que devuelve el proveedor (Resend) cuando se envió
    providerId: text("provider_id"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    index("email_log_appointment_idx").on(t.appointmentId),
    // Un recordatorio por cita: la fila "pending" o "sent" actúa como reserva y evita
    // duplicados si dos ejecuciones coinciden. Una fila "failed" no bloquea el reintento.
    uniqueIndex("email_log_reminder_once")
      .on(t.appointmentId)
      .where(sql`${t.kind} = 'reminder' AND ${t.status} <> 'failed'`),
  ],
);

export * from "./auth-schema";
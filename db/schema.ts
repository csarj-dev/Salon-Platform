import {
  pgTable, pgEnum, integer, smallint, text, boolean, timestamp, time,
  primaryKey, check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const appointmentStatus = pgEnum("appointment_status", [
  "booked", "completed", "cancelled", "no_show",
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
});

export const serviceTranslation = pgTable(
  "service_translation",
  {
    serviceId: integer("service_id")
      .notNull()
      .references(() => service.id, { onDelete: "cascade" }),
    locale: text("locale").notNull(), // "es", "en"...
    name: text("name").notNull(),
    description: text("description"),
  },
  (t) => [primaryKey({ columns: [t.serviceId, t.locale] })],
);

export const staff = pgTable("staff", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  // Si se borra la foto, la entidad se queda sin foto (no se borra)
  photoId: integer("photo_id").references(() => photo.id, { onDelete: "set null" }),
});

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
    serviceId: integer("service_id").notNull().references(() => service.id),
    staffId: integer("staff_id").notNull().references(() => staff.id),
    locationId: integer("location_id").notNull().references(() => location.id),
    performedByStaffId: integer("performed_by_staff_id").references(() => staff.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: appointmentStatus("status").notNull().default("booked"),
    priceAppliedCents: integer("price_applied_cents").notNull(),
    source: appointmentSource("source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (t) => [check("ends_after_starts", sql`${t.endsAt} > ${t.startsAt}`)],
);
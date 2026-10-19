import {
  pgTable, pgEnum, integer, text, boolean, timestamp, primaryKey, check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const service = pgTable("service", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  durationMin: integer("duration_min").notNull(),
  priceCents: integer("price_cents").notNull(),
});

export const staff = pgTable("staff", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
});

export const staffService = pgTable(
  "staff_service",
  {
    staffId: integer("staff_id").notNull().references(() => staff.id),
    serviceId: integer("service_id").notNull().references(() => service.id),
  },
  (t) => [primaryKey({ columns: [t.staffId, t.serviceId] })],
);

export const appointmentStatus = pgEnum("appointment_status", [
  "booked", "completed", "cancelled", "no_show",
]);
export const appointmentSource = pgEnum("appointment_source", [
  "web", "phone", "whatsapp",
]);

export const client = pgTable("client", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  email: text("email"),
  consentAt: timestamp("consent_at", { withTimezone: true }),
});

export const appointment = pgTable(
  "appointment",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    clientId: integer("client_id").notNull().references(() => client.id),
    serviceId: integer("service_id").notNull().references(() => service.id),
    staffId: integer("staff_id").notNull().references(() => staff.id),
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
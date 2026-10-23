import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import { salonConfigSchema } from "../salon-config";
import { buildAppointmentEmail, pickEmailLocale, type EmailData } from "./build";
import { escapeHtml } from "./render";

const config = salonConfigSchema.parse({
  name: "The Room",
  timezone: "Atlantic/Canary",
  locales: ["es", "en"],
  defaultLocale: "es",
  contact: { email: "hola@theroom.test", whatsapp: "34600000000" },
  booking: { cancellationNoticeHours: 24 },
});

const data: EmailData = {
  appointmentId: 7,
  publicToken: "0f8fad5b-d9cb-469f-a165-70867728950e",
  startsAt: new Date("2026-11-02T10:30:00Z"), // Canarias en invierno: UTC+0
  endsAt: new Date("2026-11-02T11:30:00Z"),
  locale: "es",
  clientName: "Ana <b>",
  clientEmail: "ana@example.com",
  serviceName: "Diseño de cejas",
  locationName: "Local Adeje",
  locationAddress: "Calle Mayor 1",
  mapsUrl: "https://maps.example.com/x",
  staffName: "Marta",
  priceCents: 4500,
  depositCents: 1500,
};

const env = { APP_URL: "https://salon.example.com/" };
const now = new Date("2026-10-20T09:00:00Z");
const build = (kind: Parameters<typeof buildAppointmentEmail>[0], d = data, m = es) =>
  buildAppointmentEmail(kind, d, config, m, now, env);

describe("pickEmailLocale", () => {
  it("usa el idioma guardado si el salón lo ofrece, y si no el del salón", () => {
    expect(pickEmailLocale("en", config)).toBe("en");
    expect(pickEmailLocale("fr", config)).toBe("es");
    expect(pickEmailLocale(null, config)).toBe("es");
  });
});

describe("correo de confirmación", () => {
  const mail = build("confirmation");

  it("lleva asunto, datos de la cita y enlace a su página (sin doble barra)", () => {
    expect(mail.subject).toBe("Cita confirmada en The Room");
    expect(mail.text).toContain("Diseño de cejas");
    expect(mail.text).toContain("lunes, 2 de noviembre, 10:30");
    expect(mail.text).toContain("Local Adeje, Calle Mayor 1");
    expect(mail.text).toContain("45");
    expect(mail.text).toContain(
      "https://salon.example.com/es/booking/confirmed/0f8fad5b-d9cb-469f-a165-70867728950e",
    );
    expect(mail.text).toContain("24 horas");
  });

  it("escapa el HTML de los datos de la clienta", () => {
    expect(mail.html).toContain("Hola Ana &lt;b&gt;,");
    expect(mail.html).not.toContain("<b>,");
    expect(escapeHtml(`a"b'c&d`)).toBe("a&quot;b&#39;c&amp;d");
  });

  it("adjunta el archivo de calendario", () => {
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments?.[0].filename).toBe("cita.ics");
    const ics = Buffer.from(mail.attachments![0].content, "base64").toString("utf8");
    expect(ics).toContain("DTSTART:20261102T103000Z");
    expect(ics).toContain("UID:appointment-7@salon.example.com");
  });

  it("enlaza el mapa en la dirección y muestra el depósito", () => {
    expect(mail.html).toContain('href="https://maps.example.com/x"');
    expect(mail.text).toContain("Depósito");
  });
});

describe("otros correos", () => {
  it("el recordatorio no adjunta calendario", () => {
    const mail = build("reminder");
    expect(mail.subject).toBe("Recordatorio de tu cita en The Room");
    expect(mail.attachments).toBeUndefined();
  });

  it("la cancelación no lleva los datos de la cita ni el motivo interno, y ofrece reservar de nuevo", () => {
    const mail = build("cancellation");
    expect(mail.subject).toBe("Tu cita en The Room ha sido cancelada");
    expect(mail.text).toContain("Hemos cancelado tu cita del lunes, 2 de noviembre, 10:30");
    expect(mail.text).toContain("depósito");
    expect(mail.text).toContain("https://salon.example.com/es/services");
    expect(mail.attachments).toBeUndefined();
  });

  it("sin depósito, la cancelación no habla de depósitos", () => {
    const mail = build("cancellation", { ...data, depositCents: null });
    expect(mail.text).not.toContain("depósito");
  });

  it("sale en inglés cuando la clienta reservó en inglés", () => {
    const mail = build("confirmation", { ...data, locale: "en" }, en);
    expect(mail.subject).toBe("Appointment confirmed at The Room");
    expect(mail.text).toContain("Hello Ana <b>,");
    expect(mail.text).toContain("Monday, November 2");
    expect(mail.text).toContain("24 hours");
    expect(mail.text).toContain("https://salon.example.com/en/booking/confirmed/");
  });
});
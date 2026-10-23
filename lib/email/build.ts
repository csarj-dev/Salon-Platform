import { createTranslator } from "next-intl";
import { appUrl } from "../app-url";
import { formatDateTime, formatPrice } from "../format";
import type { SalonConfig } from "../salon-config";
import type { EmailMessage } from "./driver";
import { buildIcs } from "./ics";
import { renderEmail, type EmailRow } from "./render";

// Mensajes de la carpeta messages/ (se cargan por idioma, igual que hace la web)
export type Messages = Record<string, unknown>;

export type EmailKind = "confirmation" | "cancellation" | "reminder";

export type EmailData = {
  appointmentId: number;
  publicToken: string;
  startsAt: Date;
  endsAt: Date;
  // Idioma ya resuelto (uno de los del salón)
  locale: string;
  clientName: string;
  clientEmail: string | null;
  serviceName: string;
  locationName: string;
  locationAddress: string | null;
  mapsUrl: string | null;
  staffName: string;
  priceCents: number;
  depositCents: number | null;
};

// El idioma guardado en la cita si el salón lo ofrece; si no, el del salón
export function pickEmailLocale(
  stored: string | null | undefined,
  config: Pick<SalonConfig, "locales" | "defaultLocale">,
): string {
  return stored && config.locales.includes(stored) ? stored : config.defaultLocale;
}

// ───────── Contenido (puro: no toca la base de datos ni la red) ─────────

export function buildAppointmentEmail(
  kind: EmailKind,
  data: EmailData,
  config: SalonConfig,
  messages: Messages,
  now: Date,
  env: Record<string, string | undefined> = process.env,
): Omit<EmailMessage, "to" | "idempotencyKey"> {
    const t = createTranslator({
        locale: data.locale,
        messages: messages as Parameters<typeof createTranslator>[0]["messages"],
        namespace: "Email",
        // Si falta un texto o está mal escrito, se corta: mejor un correo "fallido" en
        // email_log (con el motivo) que uno enviado con "Email.confirmation.subject" de asunto
        onError: (error) => {
        throw error;
        },
    });
  const base = appUrl(env);
  const when = formatDateTime(data.startsAt, data.locale, config.timezone);
  const salon = config.name;

  const rows: EmailRow[] = [
    { label: t("common.service"), value: data.serviceName },
    { label: t("common.when"), value: when },
    {
      label: t("common.where"),
      value: [data.locationName, data.locationAddress].filter(Boolean).join(", "),
      ...(data.mapsUrl ? { href: data.mapsUrl } : {}),
    },
    { label: t("common.with"), value: data.staffName },
    { label: t("common.price"), value: formatPrice(data.priceCents, data.locale, config.currency) },
  ];
  if (data.depositCents !== null && kind !== "cancellation") {
    rows.push({
      label: t("common.deposit"),
      value: formatPrice(data.depositCents, data.locale, config.currency),
    });
  }

  const cancelNotice = t("common.cancelNotice", { hours: config.booking.cancellationNoticeHours });
  const appointmentUrl = `${base}/${data.locale}/booking/confirmed/${data.publicToken}`;

  const contactLines: string[] = [salon];
  if (config.contact.email) contactLines.push(config.contact.email);
  if (config.contact.whatsapp) contactLines.push(`WhatsApp +${config.contact.whatsapp}`);

  const layoutBase = {
    lang: data.locale,
    salonName: salon,
    greeting: t("common.greeting", { name: data.clientName }),
    footer: contactLines,
    colors: { primary: config.theme.primary, primaryForeground: config.theme.primaryForeground },
  };

  if (kind === "cancellation") {
    const intro = [t("cancellation.intro", { when, service: data.serviceName })];
    if (data.depositCents !== null) intro.push(t("cancellation.deposit"));
    const { html, text } = renderEmail({
      ...layoutBase,
      preheader: t("cancellation.preheader", { when, service: data.serviceName }),
      intro,
      rows: [],
      outro: [t("cancellation.rebook")],
      button: { label: t("cancellation.rebookButton"), url: `${base}/${data.locale}/services` },
    });
    return { subject: t("cancellation.subject", { salon }), html, text };
  }

  const intro = [t(`${kind}.intro`)];
  const outro = [cancelNotice];
  const attachments: EmailMessage["attachments"] = [];
  if (kind === "confirmation") {
    outro.push(t("confirmation.calendar"));
    const ics = buildIcs({
      uid: `appointment-${data.appointmentId}@${new URL(base).hostname}`,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      summary: `${data.serviceName} · ${salon}`,
      description: `${t("common.with")}: ${data.staffName}\n${appointmentUrl}`,
      location: [data.locationName, data.locationAddress].filter(Boolean).join(", "),
      now,
    });
    attachments.push({ filename: "cita.ics", content: Buffer.from(ics, "utf8").toString("base64") });
  }

  const { html, text } = renderEmail({
    ...layoutBase,
    preheader: t(`${kind}.preheader`, { when }),
    intro,
    rows,
    outro,
    button: { label: t("common.viewAppointment"), url: appointmentUrl },
  });
  return {
    subject: t(`${kind}.subject`, { salon }),
    html,
    text,
    ...(attachments.length ? { attachments } : {}),
  };
}
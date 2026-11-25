// Correo con el código para usar un depósito guardado (lib/deposit-codes.ts). No se apunta en
// email_log: no es de una cita, y el código no se guarda en claro en ningún sitio.
import { createTranslator } from "next-intl";
import { formatPrice } from "../format";
import type { SalonConfig } from "../salon-config";
import type { Messages } from "./build";
import { sendEmail, type EmailEnv } from "./driver";
import { renderEmail } from "./render";

export type DepositCodeEmail = { to: string; code: string; cents: number; locale: string };

type EmailConfig = Pick<SalonConfig, "name" | "currency" | "contact" | "theme" | "locales" | "defaultLocale">;

export function buildDepositCodeEmail(data: DepositCodeEmail, config: EmailConfig, messages: Messages) {
  const t = createTranslator({
    locale: data.locale,
    messages: messages as Parameters<typeof createTranslator>[0]["messages"],
    namespace: "Email",
    onError: (error) => {
      throw error;
    },
  });
  const amount = formatPrice(data.cents, data.locale, config.currency);
  const footer: string[] = [config.name];
  if (config.contact.email) footer.push(config.contact.email);
  if (config.contact.whatsapp) footer.push(`WhatsApp +${config.contact.whatsapp}`);

  const { html, text } = renderEmail({
    lang: data.locale,
    salonName: config.name,
    preheader: t("depositCode.preheader", { code: data.code }),
    greeting: t("depositCode.greeting"),
    intro: [t("depositCode.intro", { amount, salon: config.name })],
    rows: [{ label: t("depositCode.codeLabel"), value: data.code }],
    outro: [t("depositCode.expires"), t("depositCode.ignore")],
    footer,
    colors: { primary: config.theme.primary, primaryForeground: config.theme.primaryForeground },
  });
  return { subject: t("depositCode.subject", { code: data.code, salon: config.name }), html, text };
}

// Lo manda. Devuelve si salió bien (un fallo se escribe en el registro del servidor).
export async function sendDepositCodeEmail(
  data: DepositCodeEmail,
  config: EmailConfig,
  env: EmailEnv = process.env,
): Promise<boolean> {
  const locale = config.locales.includes(data.locale) ? data.locale : config.defaultLocale;
  const messages = (await import(`../../messages/${locale}.json`)).default as Messages;
  const mail = buildDepositCodeEmail({ ...data, locale }, config, messages);
  const result = await sendEmail({ to: data.to, ...mail }, env);
  if (!result.ok) console.error(`[email] código del depósito guardado: ${result.error}`);
  return result.ok;
}
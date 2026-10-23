// Envío de correos. EMAIL_DRIVER=console (desarrollo: lo escribe en la terminal, no envía nada)
// o resend (producción). Se llama a la API de Resend con fetch, sin instalar ningún paquete.

export type EmailAttachment = { filename: string; content: string }; // content en base64

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
  // Evita duplicados si se reintenta la misma petición (Resend lo respeta durante 24 h)
  idempotencyKey?: string;
};

export type EmailResult = { ok: true; id: string | null } | { ok: false; error: string };

// Variables que se leen: EMAIL_DRIVER, RESEND_API_KEY y EMAIL_FROM
export type EmailEnv = Record<string, string | undefined>;

const RESEND_URL = "https://api.resend.com/emails";

type Fetch = typeof fetch;

export async function sendEmail(
  message: EmailMessage,
  env: EmailEnv = process.env,
  fetchImpl: Fetch = fetch,
): Promise<EmailResult> {
  const driver = env.EMAIL_DRIVER ?? "console";

  if (driver === "console") {
    const lines = [
      "──────── correo (EMAIL_DRIVER=console: no se envía) ────────",
      `Para:   ${message.to}`,
      `Asunto: ${message.subject}`,
    ];
    if (message.attachments?.length) {
      lines.push(`Adjuntos: ${message.attachments.map((a) => a.filename).join(", ")}`);
    }
    lines.push("", message.text, "────────────────────────────────────────────────────────────");
    console.log(lines.join("\n"));
    return { ok: true, id: null };
  }

  if (driver !== "resend") {
    return { ok: false, error: `EMAIL_DRIVER desconocido: ${driver} (usa console o resend)` };
  }
  if (!env.RESEND_API_KEY) return { ok: false, error: "Falta RESEND_API_KEY" };
  if (!env.EMAIL_FROM) return { ok: false, error: "Falta EMAIL_FROM" };

  try {
    const response = await fetchImpl(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        ...(message.idempotencyKey ? { "Idempotency-Key": message.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        ...(message.attachments?.length ? { attachments: message.attachments } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });

    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const detail =
        body && typeof body === "object"
          ? [(body as { name?: unknown }).name, (body as { message?: unknown }).message]
              .filter((v): v is string => typeof v === "string")
              .join(": ")
          : "";
      return { ok: false, error: `Resend ${response.status}${detail ? ` ${detail}` : ""}` };
    }
    const id = body && typeof body === "object" ? (body as { id?: unknown }).id : undefined;
    return { ok: true, id: typeof id === "string" ? id : null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
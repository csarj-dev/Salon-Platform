import { afterEach, describe, expect, it, vi } from "vitest";
import { sendEmail, type EmailMessage } from "./driver";

const message: EmailMessage = {
  to: "clienta@example.com",
  subject: "Cita confirmada",
  html: "<p>Hola</p>",
  text: "Hola",
  replyTo: "hola@salon.test",
  attachments: [{ filename: "cita.ics", content: "QkVHSU4=" }],
  idempotencyKey: "confirmation/1/1",
};

const resendEnv = {
  EMAIL_DRIVER: "resend",
  RESEND_API_KEY: "re_test",
  EMAIL_FROM: "The Room <citas@salon.test>",
};

function fakeFetch(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

afterEach(() => vi.restoreAllMocks());

describe("driver console", () => {
  it("es el predeterminado: escribe el correo y no llama a la red", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const fetchMock = vi.fn();
    const result = await sendEmail(message, {}, fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ ok: true, id: null });
    expect(fetchMock).not.toHaveBeenCalled();
    const printed = String(log.mock.calls[0][0]);
    expect(printed).toContain("clienta@example.com");
    expect(printed).toContain("Cita confirmada");
    expect(printed).toContain("cita.ics");
  });
});

describe("driver resend", () => {
  it("envía a la API de Resend con la clave, el cuerpo y la clave de idempotencia", async () => {
    const fetchMock = fakeFetch(200, { id: "abc-123" });
    const result = await sendEmail(message, resendEnv, fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ ok: true, id: "abc-123" });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test");
    expect(headers["Idempotency-Key"]).toBe("confirmation/1/1");
    expect(JSON.parse(String(init.body))).toEqual({
      from: "The Room <citas@salon.test>",
      to: ["clienta@example.com"],
      subject: "Cita confirmada",
      html: "<p>Hola</p>",
      text: "Hola",
      reply_to: "hola@salon.test",
      attachments: [{ filename: "cita.ics", content: "QkVHSU4=" }],
    });
  });

  it("sin adjuntos ni respuesta a no manda esos campos", async () => {
    const fetchMock = fakeFetch(200, { id: "x" });
    await sendEmail(
      { to: "a@b.co", subject: "s", html: "h", text: "t" },
      resendEnv,
      fetchMock as unknown as typeof fetch,
    );
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body).not.toHaveProperty("attachments");
    expect(body).not.toHaveProperty("reply_to");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBeUndefined();
  });

  it("devuelve el motivo cuando Resend rechaza el envío", async () => {
    const fetchMock = fakeFetch(422, {
      statusCode: 422,
      name: "validation_error",
      message: "The from address is not verified",
    });
    const result = await sendEmail(message, resendEnv, fetchMock as unknown as typeof fetch);
    expect(result).toEqual({
      ok: false,
      error: "Resend 422 validation_error: The from address is not verified",
    });
  });

  it("un fallo de red no lanza: devuelve el error", async () => {
    const failing = vi.fn(async () => {
      throw new Error("fetch failed");
    });
    expect(await sendEmail(message, resendEnv, failing as unknown as typeof fetch)).toEqual({
      ok: false,
      error: "fetch failed",
    });
  });

  it("avisa de la configuración que falta, sin llamar a la red", async () => {
    const fetchMock = vi.fn();
    const f = fetchMock as unknown as typeof fetch;
    expect(await sendEmail(message, { ...resendEnv, RESEND_API_KEY: "" }, f)).toEqual({
      ok: false,
      error: "Falta RESEND_API_KEY",
    });
    expect(await sendEmail(message, { ...resendEnv, EMAIL_FROM: undefined }, f)).toEqual({
      ok: false,
      error: "Falta EMAIL_FROM",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rechaza un driver desconocido", async () => {
    const result = await sendEmail(message, { EMAIL_DRIVER: "smtp" });
    expect(result.ok).toBe(false);
  });
});
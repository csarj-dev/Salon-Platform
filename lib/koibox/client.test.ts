import { describe, expect, it } from "vitest";
import { buildUrl, createKoiboxClient, findOrCreateClient } from "./client";
import { KOIBOX_STATUS, WEB_TAG, withWebTag } from "./statuses";
import { createFakeKoibox, type FakeSeed } from "./fake";
import { KoiboxError, RateLimiter, type Clock } from "./limits";
import { refId, type KoiboxAppointmentInput } from "./types";

const KEY = "clave-salon";

const seed: FakeSeed = {
  users: [
    { id: 11, name: "Lucía" },
    { id: 12, name: "Nerea", from: "10:00", to: "12:00" },
  ],
  services: [
    { id: 501, name: "Lifting de pestañas", duration: "01:00:00", price: "45.00", userIds: [11, 12] },
    { id: 502, name: "Diseño de cejas", duration: "00:30:00", price: "15.00", userIds: [11] },
  ],
  clients: [{ id: 900, nombre: "Laura", apellido1: "Gómez", movil: "612 345 678", email: "laura@ejemplo.com" }],
};

// Reloj de mentira: dormir solo adelanta el tiempo
function fakeClock(start = 1_000_000) {
  let t = start;
  const slept: number[] = [];
  const clock: Clock = {
    now: () => t,
    sleep: async (ms) => {
      slept.push(ms);
      t += ms;
    },
  };
  return { clock, slept };
}

function setup(opts: { seed?: FakeSeed; ratePerMinute?: number; limit?: number } = {}) {
  const { clock, slept } = fakeClock();
  const fake = createFakeKoibox({ [KEY]: opts.seed ?? seed }, { now: clock.now, ratePerMinute: opts.ratePerMinute });
  const api = createKoiboxClient({
    apiKey: KEY,
    fetchImpl: fake.fetch,
    clock,
    limiter: new RateLimiter(opts.limit ?? 1000, 60_000, clock),
    random: () => 0,
  });
  return { api, fake, slept };
}

// Lo que mandamos a Koibox: los campos van con sus nombres
const booking: KoiboxAppointmentInput = {
  titulo: "Lifting de pestañas · Web",
  fecha: "2026-11-05",
  hora_inicio: "10:30:00",
  hora_fin: "11:30:00",
  user: 11,
  cliente: 900,
  servicios: [501],
  estado: KOIBOX_STATUS.PENDING,
  notas: "Reserva web #1",
  tags: [{ name: WEB_TAG.PAYMENT_PENDING }],
};

describe("buildUrl", () => {
  it("une las listas con comas y omite lo que no viene", () => {
    expect(buildUrl("https://x.test/api/", "/agenda/", { servicios: [1, 2], user: undefined, fecha: "2026-11-05" })).toBe(
      "https://x.test/api/agenda/?servicios=1%2C2&fecha=2026-11-05",
    );
  });
});

describe("cliente de Koibox", () => {
  it("manda la clave en X-Koibox-Key y lee los datos de la clave", async () => {
    const { api } = setup();
    expect(await api.me()).toMatchObject({ centro: expect.any(Number) });
  });

  it("con una clave que no existe da un error 'forbidden' sin reintentar", async () => {
    const { clock } = fakeClock();
    const fake = createFakeKoibox({ [KEY]: seed }, { now: clock.now });
    const api = createKoiboxClient({ apiKey: "otra", fetchImpl: fake.fetch, clock, limiter: new RateLimiter(1000, 60_000, clock) });
    await expect(api.me()).rejects.toMatchObject({ code: "forbidden", status: 403, retryable: false });
    expect(fake.calls).toHaveLength(1);
  });

  it("recorre todas las páginas de 50", async () => {
    const many: FakeSeed = {
      users: [{ id: 1, name: "A" }],
      services: Array.from({ length: 120 }, (_, i) => ({ id: i + 1, name: `S${i + 1}`, duration: "00:30:00", userIds: [1] })),
    };
    const { api, fake } = setup({ seed: many });
    const all = await api.listServices();
    expect(all).toHaveLength(120);
    expect(all.at(-1)?.nombre).toBe("S120");
    expect(fake.calls.map((c) => new URLSearchParams(c.search).get("offset"))).toEqual(["0", "50", "100"]);
  });

  it("da los huecos libres de una profesional y quita los ocupados", async () => {
    const { api } = setup();
    await api.createAppointment(booking);
    const times = await api.availableTimes({ serviceIds: [501], date: "2026-11-05", userId: 11 });
    const hours = times.map((h) => h.hora);
    expect(hours).toContain("09:30"); // 9:30-10:30 cabe justo antes
    expect(hours).not.toContain("10:00"); // 10:00-11:00 pisa la cita
    expect(hours).not.toContain("11:00");
    expect(hours).toContain("11:30");
    expect(times.every((h) => h.user === 11)).toBe(true);
  });

  it("crea la cita en PENDIENTE con su etiqueta y la lee", async () => {
    const { api } = setup();
    const created = await api.createAppointment(booking);
    expect(refId(created.estado)).toBe(KOIBOX_STATUS.PENDING);
    expect(created.tags?.map((t) => t.name)).toEqual([WEB_TAG.PAYMENT_PENDING]);
    const again = await api.getAppointment(created.id);
    expect(again?.notas).toBe("Reserva web #1");
  });

  it("no deja crear una cita que pisa otra", async () => {
    const { api } = setup();
    await api.createAppointment(booking);
    await expect(
      api.createAppointment({ ...booking, hora_inicio: "11:00:00", hora_fin: "12:00:00" }),
    ).rejects.toMatchObject({ code: "bad_request", status: 400 });
  });

  it("anular libera el hueco; cambia estado, notas y etiqueta con PATCH", async () => {
    const { api } = setup();
    const created = await api.createAppointment(booking);
    const updated = await api.updateAppointment(created.id, {
      estado: KOIBOX_STATUS.CANCELLED,
      notas: "Reserva web #1\nNo pagó a tiempo",
      tags: withWebTag(created.tags, WEB_TAG.DEPOSIT_PAID),
    });
    expect(refId(updated.estado)).toBe(KOIBOX_STATUS.CANCELLED);
    expect(updated.notas).toContain("No pagó");
    expect(updated.tags?.map((t) => t.name)).toEqual([WEB_TAG.DEPOSIT_PAID]);
    // Ya se puede reservar a esa hora
    await expect(api.createAppointment(booking)).resolves.toMatchObject({ hora_inicio: "10:30:00" });
  });

  it("una cita que no existe es null", async () => {
    const { api } = setup();
    expect(await api.getAppointment(12345)).toBeNull();
  });

  it("lista las citas de un día filtrando por profesional y estado", async () => {
    const { api } = setup();
    const first = await api.createAppointment(booking);
    await api.createAppointment({ ...booking, user: 12, hora_inicio: "10:00:00", hora_fin: "11:00:00" });
    await api.createAppointment({ ...booking, fecha: "2026-11-06" });
    await api.updateAppointment(first.id, { estado: KOIBOX_STATUS.COMPLETED });

    expect(await api.listAppointments({ from: "2026-11-05", to: "2026-11-05" })).toHaveLength(2);
    expect(await api.listAppointments({ from: "2026-11-05", to: "2026-11-06", userIds: [11] })).toHaveLength(2);
    const pending = await api.listAppointments({ from: "2026-11-05", to: "2026-11-06", statuses: [KOIBOX_STATUS.PENDING] });
    expect(pending.map((a) => refId(a.user))).toEqual([12, 11]);
  });
});

describe("reintentos", () => {
  it("ante un 429 espera lo que diga Retry-After y repite (también en POST)", async () => {
    const { api, fake, slept } = setup();
    fake.failNext(429, 1, { detail: "Demasiadas peticiones." }, { "Retry-After": "2" });
    await expect(api.createAppointment(booking)).resolves.toMatchObject({ id: expect.any(Number) });
    expect(slept).toEqual([2000]);
    expect(fake.center(KEY).appointments).toHaveLength(1);
  });

  it("ante un 503 en una lectura reintenta con espera creciente", async () => {
    const { api, fake, slept } = setup();
    fake.failNext(503, 2);
    await expect(api.listServices()).resolves.toHaveLength(2);
    expect(slept).toEqual([500, 1000]);
  });

  it("no repite un POST que falló con 5xx (podría duplicar la cita)", async () => {
    const { api, fake } = setup();
    fake.failNext(500);
    const error = await api.createAppointment(booking).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(KoiboxError);
    expect(error).toMatchObject({ code: "server_error", retryable: true });
    expect(fake.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("se rinde tras 3 reintentos", async () => {
    const { api, fake } = setup();
    fake.failNext(503, 10);
    await expect(api.me()).rejects.toMatchObject({ code: "server_error" });
    expect(fake.calls).toHaveLength(4);
  });

  it("un corte de red es un error 'network'", async () => {
    const { clock } = fakeClock();
    const api = createKoiboxClient({
      apiKey: KEY,
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
      clock,
      limiter: new RateLimiter(1000, 60_000, clock),
      maxRetries: 0,
    });
    await expect(api.me()).rejects.toMatchObject({ code: "network" });
  });

  it("el limitador evita los 429 de Koibox", async () => {
    // Koibox admite 5 por minuto aquí y nosotros nos limitamos a 5: nunca llega un 429
    const { api, fake, slept } = setup({ ratePerMinute: 5, limit: 5 });
    for (let i = 0; i < 12; i++) await api.me();
    expect(fake.calls).toHaveLength(12);
    expect(slept.length).toBeGreaterThan(0);
    expect(slept.every((ms) => ms > 0 && ms <= 60_000)).toBe(true);
  });
});

describe("findOrCreateClient", () => {
  it("encuentra a la clienta aunque en Koibox el móvil tenga espacios", async () => {
    const { api } = setup();
    const r = await findOrCreateClient(api, { name: "Laura Gómez", phone: "+34612345678" }, "34");
    expect(r).toEqual({ client: expect.objectContaining({ id: 900 }), created: false });
  });

  it("si no existe, la crea con nombre y apellidos separados y sin publicidad", async () => {
    const { api, fake } = setup();
    const r = await findOrCreateClient(api, { name: "Marta Ruiz León", phone: "600123123", email: "marta@ejemplo.com" }, "34");
    expect(r.created).toBe(true);
    expect(fake.center(KEY).clients.at(-1)).toMatchObject({
      nombre: "Marta",
      apellido1: "Ruiz León",
      movil: "600123123",
      prefijo_tel: "34",
      email: "marta@ejemplo.com",
    });
  });

  it("con varias fichas del mismo móvil prefiere la del mismo correo", async () => {
    const twins: FakeSeed = {
      ...seed,
      clients: [
        { id: 1, nombre: "Ana", movil: "600000000", email: "ana@ejemplo.com" },
        { id: 2, nombre: "Sara", movil: "600000000", email: "sara@ejemplo.com" },
      ],
    };
    const { api } = setup({ seed: twins });
    const bySara = await findOrCreateClient(api, { name: "Sara", phone: "600000000", email: "SARA@ejemplo.com" }, "34");
    expect(bySara.client.id).toBe(2);
    const noEmail = await findOrCreateClient(api, { name: "Otra", phone: "600000000" }, "34");
    expect(noEmail.client.id).toBe(1);
  });
});
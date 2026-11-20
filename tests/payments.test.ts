import "./test-env"; // tiene que ser el primer import
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, pgClient } from "../db";
import {
  appointment, client, location, locationService, payment, schedule, service, staff, staffService, timeOff,
} from "../db/schema";
import { applyRedsysNotification, refundPayment, startDepositPayment } from "../lib/payments-db";
import { REDSYS_TEST_MERCHANT } from "../lib/redsys/gateway";
import { SIGNATURE_VERSION, decodeParameters, encodeParameters, sign } from "../lib/redsys/signature";
import { salonConfigSchema } from "../lib/salon-config";

const config = salonConfigSchema.parse({
  name: "Salón de prueba",
  timezone: "Atlantic/Canary",
  locales: ["es"],
  defaultLocale: "es",
  contact: { whatsapp: "34600000000" },
  booking: {},
  payments: {
    defaultCollector: "salon",
    collectors: {
      salon: { label: "Salón" }, // sin TPV real
      luz: { label: "Luz", redsys: { merchantCode: "123456789", terminal: 2, keyEnv: "REDSYS_KEY_LUZ" } },
    },
  },
});

const ENV = { APP_URL: "https://salon.example.com" };
const NOW = new Date("2026-11-19T10:00:00Z");
const DUE = new Date("2026-11-19T10:15:00Z"); // 15 min para pagar
const urls = { okUrl: "https://salon.example.com/ok", koUrl: "https://salon.example.com/ko", locale: "es" };

let ids: { loc: number; svc: number; ana: number; luz: number; client: number };

// Mismo orden que los demás tests: lo que apunta a staff, service o location va antes
async function wipe() {
  await db.delete(appointment); // se lleva sus pagos
  await db.delete(timeOff);
  await db.delete(schedule);
  await db.delete(locationService);
  await db.delete(staffService);
  await db.delete(client);
  await db.delete(staff);
  await db.delete(service);
  await db.delete(location);
}

// Una cita web esperando el depósito de 15 €. Cada una a una hora distinta (no se pueden pisar).
let slot = 0;
async function pendingAppointment(staffId = ids.ana, overrides: Partial<typeof appointment.$inferInsert> = {}) {
  const startsAt = new Date(Date.UTC(2026, 10, 20, 0, 0) + slot++ * 3_600_000);
  const [row] = await db
    .insert(appointment)
    .values({
      clientId: ids.client,
      clientName: "Clienta Test",
      clientEmail: "clienta.test@example.com",
      serviceId: ids.svc,
      staffId,
      locationId: ids.loc,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3_600_000),
      status: "pending_deposit",
      priceAppliedCents: 4500,
      source: "web",
      depositCents: 1500,
      depositDueAt: DUE,
      ...overrides,
    })
    .returning({ id: appointment.id });
  return row.id;
}

async function start(appointmentId: number, env: Record<string, string> = ENV) {
  const r = await startDepositPayment(appointmentId, urls, config, NOW, env);
  if (!r.ok) throw new Error(`No se pudo empezar el pago: ${r.reason}`);
  return r;
}

// Aviso como el que manda Redsys, firmado con la clave de pruebas (o con otra, para probar)
function notice(
  order: string,
  opts: { response?: string; amount?: string; merchant?: string; key?: string } = {},
) {
  const params = encodeParameters({
    Ds_Date: "19%2F11%2F2026",
    Ds_Hour: "10%3A05",
    Ds_Amount: opts.amount ?? "1500",
    Ds_Currency: "978",
    Ds_Order: order,
    Ds_MerchantCode: opts.merchant ?? REDSYS_TEST_MERCHANT.merchantCode,
    Ds_Terminal: "001",
    Ds_Response: opts.response ?? "0000",
    Ds_AuthorisationCode: opts.response && opts.response !== "0000" ? "" : "123456",
    Ds_TransactionType: "0",
  });
  const signature = sign(params, order, opts.key ?? REDSYS_TEST_MERCHANT.key);
  return {
    Ds_SignatureVersion: SIGNATURE_VERSION,
    Ds_MerchantParameters: params,
    // Redsys la manda en Base64 para URL
    Ds_Signature: signature.replace(/\+/g, "-").replace(/\//g, "_"),
  };
}

const later = new Date("2026-11-19T10:05:00Z");
const apply = (form: ReturnType<typeof notice>, now = later) => applyRedsysNotification(form, config, now, ENV);

async function paymentRow(id: number) {
  const [row] = await db.select().from(payment).where(eq(payment.id, id));
  return row;
}
async function appointmentRow(id: number) {
  const [row] = await db.select().from(appointment).where(eq(appointment.id, id));
  return row;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await wipe();
  const [l] = await db.insert(location).values({ name: "Local de prueba" }).returning();
  const [s] = await db
    .insert(service)
    .values({ name: "Con depósito", durationMin: 60, priceCents: 4500, depositCents: 1500 })
    .returning();
  const [ana, luz] = await db
    .insert(staff)
    .values([{ name: "Ana" }, { name: "Luz", collector: "luz" }])
    .returning();
  const [c] = await db.insert(client).values({ name: "Clienta Test", phone: "600111222" }).returning();
  ids = { loc: l.id, svc: s.id, ana: ana.id, luz: luz.id, client: c.id };
});

beforeEach(async () => {
  await db.delete(appointment);
});

afterAll(async () => {
  await wipe();
  await pgClient.end();
});

describe("startDepositPayment", () => {
  it("guarda el intento y devuelve el formulario firmado para Redsys", async () => {
    const appt = await pendingAppointment();
    const r = await start(appt);

    const row = await paymentRow(r.paymentId);
    expect(row).toMatchObject({
      appointmentId: appt,
      collector: "salon",
      environment: "test",
      merchantCode: "999008881",
      terminal: 1,
      orderCode: r.orderCode,
      amountCents: 1500,
      status: "created",
      notifiedAt: null,
    });

    const params = decodeParameters(r.form.fields.Ds_MerchantParameters);
    expect(params).toMatchObject({
      DS_MERCHANT_AMOUNT: "1500",
      DS_MERCHANT_ORDER: r.orderCode,
      DS_MERCHANT_MERCHANTURL: "https://salon.example.com/api/payments/redsys/notify",
      DS_MERCHANT_URLOK: urls.okUrl,
      DS_MERCHANT_URLKO: urls.koUrl,
      DS_MERCHANT_MERCHANTNAME: "Salón de prueba",
    });
  });

  it("cada intento lleva su propio número de pedido", async () => {
    const appt = await pendingAppointment();
    const a = await start(appt);
    const b = await start(appt);
    expect(a.orderCode).not.toBe(b.orderCode);
    expect(await db.select().from(payment).where(eq(payment.appointmentId, appt))).toHaveLength(2);
  });

  it("solo si la cita está esperando el depósito y en plazo", async () => {
    const booked = await pendingAppointment(ids.ana, { status: "booked" });
    const expired = await pendingAppointment(ids.ana, { status: "expired" });
    const overdue = await pendingAppointment(ids.ana, { depositDueAt: new Date("2026-11-19T09:59:00Z") });
    const go = (id: number) => startDepositPayment(id, urls, config, NOW, ENV);
    expect(await go(booked)).toEqual({ ok: false, reason: "not_pending" });
    expect(await go(expired)).toEqual({ ok: false, reason: "expired" });
    expect(await go(overdue)).toEqual({ ok: false, reason: "expired" });
    expect(await go(999_999)).toEqual({ ok: false, reason: "not_found" });
  });

  it("en real, con el TPV del cobrador; sin TPV o sin clave no empieza", async () => {
    const live = { ...ENV, REDSYS_ENVIRONMENT: "live" };
    const withLuz = await pendingAppointment(ids.luz);
    const withSalon = await pendingAppointment(ids.ana);

    expect(await startDepositPayment(withSalon, urls, config, NOW, live)).toEqual({ ok: false, reason: "no_tpv" });
    expect(await startDepositPayment(withLuz, urls, config, NOW, live)).toEqual({ ok: false, reason: "no_key" });

    const r = await start(withLuz, { ...live, REDSYS_KEY_LUZ: REDSYS_TEST_MERCHANT.key });
    expect(r.form.action).toBe("https://sis.redsys.es/sis/realizarPago");
    expect(await paymentRow(r.paymentId)).toMatchObject({
      collector: "luz",
      environment: "live",
      merchantCode: "123456789",
      terminal: 2,
    });
  });
});

describe("applyRedsysNotification", () => {
  it("pago bueno: el pago queda pagado y la cita confirmada", async () => {
    const appt = await pendingAppointment();
    const { paymentId, orderCode } = await start(appt);

    expect(await apply(notice(orderCode))).toEqual({ ok: true, outcome: "paid", appointmentId: appt, paymentId });
    expect(await paymentRow(paymentId)).toMatchObject({
      status: "paid",
      responseCode: 0,
      authCode: "123456",
      notifiedAt: later,
    });
    expect(await appointmentRow(appt)).toMatchObject({
      status: "booked",
      depositPaidAt: later,
      depositValidatedBy: null,
    });
  });

  it("el mismo aviso dos veces solo se aplica una", async () => {
    const appt = await pendingAppointment();
    const { orderCode } = await start(appt);
    expect((await apply(notice(orderCode))).ok).toBe(true);
    const again = await apply(notice(orderCode), new Date("2026-11-19T10:06:00Z"));
    expect(again).toMatchObject({ ok: true, outcome: "duplicate" });
    expect((await appointmentRow(appt)).depositPaidAt).toEqual(later);
  });

  it("pago denegado: la cita sigue esperando y se puede volver a intentar", async () => {
    const appt = await pendingAppointment();
    const first = await start(appt);
    expect(await apply(notice(first.orderCode, { response: "0190" }))).toMatchObject({ ok: true, outcome: "failed" });
    expect(await paymentRow(first.paymentId)).toMatchObject({ status: "failed", responseCode: 190, authCode: null });
    expect((await appointmentRow(appt)).status).toBe("pending_deposit");

    const second = await start(appt);
    expect(await apply(notice(second.orderCode))).toMatchObject({ ok: true, outcome: "paid" });
    expect((await appointmentRow(appt)).status).toBe("booked");
  });

  it("una firma que no cuadra no toca nada", async () => {
    const appt = await pendingAppointment();
    const { paymentId, orderCode } = await start(appt);
    const forged = notice(orderCode, { key: "Mk9m98IfEblmPfrpsawt7BmxObt98Jev" });
    expect(await apply(forged)).toEqual({ ok: false, reason: "bad_signature" });

    const tampered = { ...notice(orderCode), Ds_MerchantParameters: notice(orderCode, { amount: "1" }).Ds_MerchantParameters };
    expect(await apply(tampered)).toEqual({ ok: false, reason: "bad_signature" });

    expect((await paymentRow(paymentId)).status).toBe("created");
    expect((await appointmentRow(appt)).status).toBe("pending_deposit");
  });

  it("importe o comercio distintos de los del pedido: no se aplica", async () => {
    const appt = await pendingAppointment();
    const { orderCode } = await start(appt);
    expect(await apply(notice(orderCode, { amount: "100" }))).toEqual({ ok: false, reason: "mismatch" });
    expect(await apply(notice(orderCode, { merchant: "111111111" }))).toEqual({ ok: false, reason: "mismatch" });
    expect((await appointmentRow(appt)).status).toBe("pending_deposit");
  });

  it("un pedido que no es nuestro o un aviso mal formado", async () => {
    expect(await apply(notice("9999zzzzzzzz"))).toEqual({ ok: false, reason: "unknown_order" });
    expect(await apply({ ...notice("9999zzzzzzzz"), Ds_SignatureVersion: "otra" })).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("pagado cuando la cita ya no esperaba el depósito: queda para revisar", async () => {
    const appt = await pendingAppointment();
    const { paymentId, orderCode } = await start(appt);
    await db.update(appointment).set({ status: "expired" }).where(eq(appointment.id, appt));

    expect(await apply(notice(orderCode))).toEqual({ ok: true, outcome: "paid_late", appointmentId: appt, paymentId });
    expect((await paymentRow(paymentId)).status).toBe("paid");
    expect((await appointmentRow(appt)).status).toBe("expired");
  });

  it("con el plazo vencido pero el hueco aún sin liberar, se acepta", async () => {
    const appt = await pendingAppointment();
    const { orderCode } = await start(appt);
    expect(await apply(notice(orderCode), new Date("2026-11-19T10:20:00Z"))).toMatchObject({ outcome: "paid" });
  });
});


describe("refundPayment", () => {
  // Un pago ya cobrado (aviso bueno aplicado)
  async function paidPayment() {
    const appt = await pendingAppointment();
    const { paymentId, orderCode } = await start(appt);
    await apply(notice(orderCode));
    return { appt, paymentId, orderCode };
  }

  // Respuesta de Redsys a la devolución, firmada con la clave de pruebas
  function refundReply(order: string, response = "0900", key: string = REDSYS_TEST_MERCHANT.key) {
    const params = encodeParameters({ Ds_Amount: "1500", Ds_Order: order, Ds_Response: response, Ds_TransactionType: "3" });
    return { Ds_SignatureVersion: SIGNATURE_VERSION, Ds_MerchantParameters: params, Ds_Signature: sign(params, order, key) };
  }
  // fetch de mentira: guarda lo que se le pidió y contesta lo que se le diga
  function fakeFetch(body: unknown) {
    const calls: { url: string; body: unknown }[] = [];
    const fn = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;
    return { fn, calls };
  }
  const refundAt = new Date("2026-11-19T12:00:00Z");

  it("devuelve el pago si Redsys lo confirma, y la cita no cambia", async () => {
    const { appt, paymentId, orderCode } = await paidPayment();
    const { fn, calls } = fakeFetch(refundReply(orderCode));

    expect(await refundPayment(paymentId, config, { now: refundAt, env: ENV, fetchFn: fn })).toEqual({
      ok: true,
      appointmentId: appt,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://sis-t.redsys.es:25443/sis/rest/trataPeticionREST");
    expect(decodeParameters((calls[0].body as { Ds_MerchantParameters: string }).Ds_MerchantParameters)).toMatchObject({
      DS_MERCHANT_ORDER: orderCode,
      DS_MERCHANT_AMOUNT: "1500",
      DS_MERCHANT_TRANSACTIONTYPE: "3",
    });
    expect(await paymentRow(paymentId)).toMatchObject({ status: "refunded", refundedAt: refundAt, refundedBy: null });
    expect((await appointmentRow(appt)).status).toBe("booked");

    // Una segunda vez ya no hay nada que devolver (ni se llama a Redsys)
    expect(await refundPayment(paymentId, config, { env: ENV, fetchFn: fn })).toEqual({ ok: false, reason: "not_paid" });
    expect(calls).toHaveLength(1);
  });

  it("si Redsys la rechaza o da error, el pago sigue cobrado", async () => {
    const { paymentId, orderCode } = await paidPayment();
    const rejected = fakeFetch(refundReply(orderCode, "0190"));
    expect(await refundPayment(paymentId, config, { env: ENV, fetchFn: rejected.fn })).toEqual({
      ok: false,
      reason: "rejected",
      detail: "190",
    });
    const sisError = fakeFetch({ errorCode: "SIS0057" });
    expect(await refundPayment(paymentId, config, { env: ENV, fetchFn: sisError.fn })).toEqual({
      ok: false,
      reason: "error",
      detail: "SIS0057",
    });
    const forged = fakeFetch(refundReply(orderCode, "0900", "Mk9m98IfEblmPfrpsawt7BmxObt98Jev"));
    expect(await refundPayment(paymentId, config, { env: ENV, fetchFn: forged.fn })).toMatchObject({
      ok: false,
      reason: "bad_reply",
    });
    expect((await paymentRow(paymentId)).status).toBe("paid");
  });

  it("sin respuesta de Redsys no se marca nada", async () => {
    const { paymentId } = await paidPayment();
    const down = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    expect(await refundPayment(paymentId, config, { env: ENV, fetchFn: down })).toEqual({ ok: false, reason: "unreachable" });
    expect((await paymentRow(paymentId)).status).toBe("paid");
  });

  it("solo se devuelve un pago cobrado", async () => {
    const appt = await pendingAppointment();
    const { paymentId } = await start(appt);
    const { fn, calls } = fakeFetch({});
    expect(await refundPayment(paymentId, config, { env: ENV, fetchFn: fn })).toEqual({ ok: false, reason: "not_paid" });
    expect(await refundPayment(999_999, config, { env: ENV, fetchFn: fn })).toEqual({ ok: false, reason: "not_found" });
    expect(calls).toHaveLength(0);
  });
});
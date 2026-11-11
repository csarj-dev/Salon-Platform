import { describe, expect, it } from "vitest";
import { clientChangeState } from "./client-changes";

const now = new Date("2026-11-10T10:00:00Z");
const config = (cancel = true, reschedule = true) => ({
  booking: { cancellationNoticeHours: 24, clientChanges: { cancel, reschedule } },
});
const at = (hoursFromNow: number) => new Date(now.getTime() + hoursFromNow * 3_600_000);

describe("clientChangeState", () => {
  it("confirmada con margen: puede cancelar y cambiar, hasta 24 h antes", () => {
    const s = clientChangeState({ status: "booked", startsAt: at(48) }, config(), now);
    expect(s).toEqual({ cancel: "allowed", reschedule: "allowed", deadline: at(24) });
  });

  it("justo en el límite todavía vale; un minuto después, no", () => {
    expect(clientChangeState({ status: "booked", startsAt: at(24) }, config(), now).cancel).toBe("allowed");
    const late = new Date(now.getTime() + 24 * 3_600_000 - 60_000);
    expect(clientChangeState({ status: "booked", startsAt: late }, config(), now).cancel).toBe("too_late");
  });

  it("dentro del plazo: tiene que escribir", () => {
    const s = clientChangeState({ status: "booked", startsAt: at(5) }, config(), now);
    expect([s.cancel, s.reschedule]).toEqual(["too_late", "too_late"]);
  });

  it("esperando el depósito: puede cancelar siempre, pero no cambiar de hora", () => {
    const s = clientChangeState({ status: "pending_deposit", startsAt: at(5) }, config(), now);
    expect([s.cancel, s.reschedule]).toEqual(["allowed", "not_applicable"]);
  });

  it("apagado en la config", () => {
    const s = clientChangeState({ status: "booked", startsAt: at(48) }, config(false, false), now);
    expect([s.cancel, s.reschedule]).toEqual(["off", "off"]);
  });

  it("cancelada, caducada o pasada: nada que hacer", () => {
    for (const status of ["cancelled", "expired", "completed", "no_show"]) {
      const s = clientChangeState({ status, startsAt: at(48) }, config(), now);
      expect([s.cancel, s.reschedule]).toEqual(["not_applicable", "not_applicable"]);
    }
  });
});
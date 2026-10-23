import { describe, expect, it } from "vitest";
import { isReminderDue, reminderWindow, type ReminderCandidate } from "./reminder-rules";

const now = new Date("2026-11-10T12:00:00Z");
const hours = (h: number) => new Date(now.getTime() + h * 3_600_000);

const base: ReminderCandidate = {
  status: "booked",
  startsAt: hours(20),
  confirmedAt: new Date("2026-11-01T09:00:00Z"),
  hasEmail: true,
};
const due = (patch: Partial<ReminderCandidate> = {}) => isReminderDue({ ...base, ...patch }, now);

describe("isReminderDue", () => {
  it("toca cuando faltan menos de 24 h y se confirmó hace días", () => {
    expect(due()).toBe(true);
  });

  it("justo a 24 h entra; pasadas las 24 h todavía no", () => {
    expect(due({ startsAt: hours(24) })).toBe(true);
    expect(due({ startsAt: new Date(hours(24).getTime() + 1) })).toBe(false);
  });

  it("no avisa si la cita empieza en una hora o menos, ni si ya pasó", () => {
    expect(due({ startsAt: hours(1.5) })).toBe(true);
    expect(due({ startsAt: hours(1) })).toBe(false);
    expect(due({ startsAt: hours(0.5) })).toBe(false);
    expect(due({ startsAt: hours(-2) })).toBe(false);
  });

  it("no avisa si se confirmó dentro de las últimas 24 h antes de la cita", () => {
    // Cita en 20 h, confirmada hace 2 h: la confirmación es reciente
    expect(due({ confirmedAt: hours(-2) })).toBe(false);
    // Cita en 20 h, confirmada exactamente 24 h antes de la cita: sí avisa
    expect(due({ confirmedAt: hours(20 - 24) })).toBe(true);
    expect(due({ confirmedAt: new Date(hours(20 - 24).getTime() + 1) })).toBe(false);
  });

  it("solo para citas confirmadas y con email", () => {
    for (const status of ["pending_deposit", "cancelled", "expired", "completed", "no_show"]) {
      expect(due({ status })).toBe(false);
    }
    expect(due({ hasEmail: false })).toBe(false);
  });
});

describe("reminderWindow", () => {
  it("va desde dentro de 1 h hasta dentro de 24 h", () => {
    const w = reminderWindow(now);
    expect(w.from).toEqual(hours(1));
    expect(w.to).toEqual(hours(24));
  });
});
import { describe, expect, it } from "vitest";
import { computeKoiboxAvailability, type KoiboxAvailabilityInput, type KoiboxTeamMember } from "./availability";
import type { KoiboxSnapshot } from "./schedule";
import type { KoiboxSchedule } from "./types";

const ZONE = "Atlantic/Canary"; // en noviembre, UTC+0
const at = (iso: string) => new Date(`${iso}Z`);

const weekdays = (user: number, from: string, to: string): KoiboxSchedule => {
  const d = { hora_inicio: from, hora_fin: to };
  return { id: user, user, centro: 1, week: null, year: null, lunes: d, martes: d, miercoles: d, jueves: d, viernes: d, sabado: null, domingo: null };
};

const lucia: KoiboxTeamMember = { staffId: 2, staffName: "Lucía", account: "salon", koiboxUserId: 11, koiboxServiceId: 501 };
const amanda: KoiboxTeamMember = { staffId: 1, staffName: "Amanda", account: "amanda", koiboxUserId: 7, koiboxServiceId: 77 };

const salon: KoiboxSnapshot = { schedules: [weekdays(11, "10:00:00", "12:00:00")], appointments: [], blocks: [] };
const amandaAccount: KoiboxSnapshot = { schedules: [weekdays(7, "11:00:00", "13:00:00")], appointments: [], blocks: [] };

const base: KoiboxAvailabilityInput = {
  team: [amanda, lucia],
  snapshots: { salon, amanda: amandaAccount },
  localBusy: [],
  durationMin: 60,
  from: "2026-11-02", // lunes
  to: "2026-11-03", // martes
  opts: { zone: ZONE, stepMin: 30, bufferMin: 0, minNoticeHours: 2 },
  now: at("2026-10-29T10:00:00"),
};

const times = (dates: Date[]) => dates.map((d) => d.toISOString().slice(11, 16));

describe("computeKoiboxAvailability", () => {
  it("calcula los huecos de cada profesional con los turnos de su cuenta y une los de todas", () => {
    const r = computeKoiboxAvailability(base);
    const monday = r.get("2026-11-02")!;
    expect(monday.perStaff.map((s) => [s.staffName, times(s.slots)])).toEqual([
      ["Amanda", ["11:00", "11:30", "12:00"]],
      ["Lucía", ["10:00", "10:30", "11:00"]],
    ]);
    expect(monday.any.map((s) => [times([s.startsAt])[0], s.staffIds])).toEqual([
      ["10:00", [2]],
      ["10:30", [2]],
      ["11:00", [1, 2]],
      ["11:30", [1]],
      ["12:00", [1]],
    ]);
  });

  it("un día lleno en Koibox no aparece (el calendario lo apaga)", () => {
    const full: KoiboxSnapshot = {
      ...salon,
      appointments: [{ userId: 11, date: "2026-11-02", start: "10:00:00", end: "12:00:00" }],
    };
    const r = computeKoiboxAvailability({ ...base, team: [lucia], snapshots: { salon: full } });
    expect(r.has("2026-11-02")).toBe(false);
    expect(r.has("2026-11-03")).toBe(true);
  });

  it("los bloqueos de Koibox y las citas de nuestra base también ocupan", () => {
    const blocked: KoiboxSnapshot = {
      ...salon,
      blocks: [{ userId: 11, date: "2026-11-02", start: "10:00:00", end: "10:30:00", recurrence: "none" }],
    };
    const r = computeKoiboxAvailability({
      ...base,
      team: [lucia],
      snapshots: { salon: blocked },
      localBusy: [{ staffId: 2, start: at("2026-11-02T11:00:00"), end: at("2026-11-02T12:00:00") }],
      durationMin: 30,
    });
    // Turno 10:00-12:00, bloqueo 10:00-10:30 y cita local 11:00-12:00: solo queda 10:30
    expect(times(r.get("2026-11-02")!.perStaff[0].slots)).toEqual(["10:30"]);
  });

  it("respeta la antelación mínima", () => {
    // A las 08:30, con 2 h de antelación, lo primero que se puede reservar es a las 10:30
    const r = computeKoiboxAvailability({ ...base, team: [lucia], snapshots: { salon }, now: at("2026-11-02T08:30:00") });
    expect(times(r.get("2026-11-02")!.perStaff[0].slots)).toEqual(["10:30", "11:00"]);
  });

  it("si falta la cuenta de una profesional, no da huecos suyos", () => {
    const r = computeKoiboxAvailability({ ...base, snapshots: { salon } });
    expect(r.get("2026-11-02")!.perStaff.map((s) => s.staffName)).toEqual(["Lucía"]);
  });

  it("sin equipo o con fechas al revés, nada", () => {
    expect(computeKoiboxAvailability({ ...base, team: [] }).size).toBe(0);
    expect(computeKoiboxAvailability({ ...base, from: "2026-11-03", to: "2026-11-02" }).size).toBe(0);
  });
});
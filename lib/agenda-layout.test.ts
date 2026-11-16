import { describe, expect, it } from "vitest";
import { agendaWindow, placeInColumn, weekOf, subtractIntervals, minutesOf, daySummary } from "./agenda-layout";

const at = (iso: string) => new Date(iso);
const iv = (from: string, to: string) => ({ start: at(from), end: at(to) });
const SOD = at("2026-11-16T00:00:00Z"); // Canarias en noviembre = UTC

describe("agendaWindow", () => {
  it("va de la primera entrada a la última salida, en horas enteras", () => {
    const w = agendaWindow(
      [iv("2026-11-16T09:30:00Z", "2026-11-16T14:00:00Z"), iv("2026-11-16T18:15:00Z", "2026-11-16T19:15:00Z")],
      SOD,
    );
    expect(w.start.toISOString()).toBe("2026-11-16T09:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-11-16T20:00:00.000Z");
    expect(w.hours).toHaveLength(11);
    expect(w.hours[0].toISOString()).toBe("2026-11-16T09:00:00.000Z");
  });

  it("sin turnos ni citas, el horario por defecto", () => {
    const w = agendaWindow([], SOD);
    expect(w.start.toISOString()).toBe("2026-11-16T09:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-11-16T20:00:00.000Z");
  });

  it("no se sale del día", () => {
    const w = agendaWindow([iv("2026-11-15T22:00:00Z", "2026-11-17T02:00:00Z")], SOD);
    expect(w.start.toISOString()).toBe("2026-11-16T00:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-11-17T00:00:00.000Z");
  });
});

describe("placeInColumn", () => {
  const w = agendaWindow([iv("2026-11-16T09:00:00Z", "2026-11-16T20:00:00Z")], SOD);

  it("pone cada cita a su hora y con su duración", () => {
    const [p] = placeInColumn([iv("2026-11-16T10:30:00Z", "2026-11-16T11:45:00Z")], w);
    expect(p.top).toBe(90);
    expect(p.height).toBe(75);
    expect([p.lane, p.lanes]).toEqual([0, 1]);
  });

  it("una cita muy corta tiene un alto mínimo para poder pulsarla", () => {
    const [p] = placeInColumn([iv("2026-11-16T10:00:00Z", "2026-11-16T10:05:00Z")], w);
    expect(p.height).toBe(15);
  });

  it("las que se pisan van una al lado de la otra; las demás ocupan todo el ancho", () => {
    const placed = placeInColumn(
      [
        iv("2026-11-16T10:00:00Z", "2026-11-16T11:00:00Z"),
        iv("2026-11-16T10:30:00Z", "2026-11-16T11:30:00Z"),
        iv("2026-11-16T12:00:00Z", "2026-11-16T13:00:00Z"),
      ],
      w,
    );
    expect(placed.map((p) => [p.lane, p.lanes])).toEqual([[0, 2], [1, 2], [0, 1]]);
  });

  it("una que empieza justo cuando acaba otra no se considera pisada", () => {
    const placed = placeInColumn(
      [iv("2026-11-16T10:00:00Z", "2026-11-16T11:00:00Z"), iv("2026-11-16T11:00:00Z", "2026-11-16T12:00:00Z")],
      w,
    );
    expect(placed.map((p) => p.lanes)).toEqual([1, 1]);
  });
});

describe("weekOf", () => {
  it("de lunes a domingo, sea cual sea el día", () => {
    expect(weekOf("2026-11-14")).toEqual({ from: "2026-11-09", to: "2026-11-15" }); // sábado
    expect(weekOf("2026-11-09")).toEqual({ from: "2026-11-09", to: "2026-11-15" }); // lunes
    expect(weekOf("2026-11-15")).toEqual({ from: "2026-11-09", to: "2026-11-15" }); // domingo
  });
  it("cruza de mes y de año", () => {
    expect(weekOf("2026-12-01")).toEqual({ from: "2026-11-30", to: "2026-12-06" });
    expect(weekOf("2027-01-01")).toEqual({ from: "2026-12-28", to: "2027-01-03" });
  });
});

describe("subtractIntervals y minutesOf", () => {
  it("quita los tramos ocupados de un turno partido", () => {
    const left = subtractIntervals(
      [iv("2026-11-16T09:00:00Z", "2026-11-16T14:00:00Z"), iv("2026-11-16T16:00:00Z", "2026-11-16T20:00:00Z")],
      [iv("2026-11-16T10:00:00Z", "2026-11-16T11:00:00Z"), iv("2026-11-16T13:30:00Z", "2026-11-16T16:30:00Z")],
    );
    expect(left.map((i) => [i.start.toISOString().slice(11, 16), i.end.toISOString().slice(11, 16)])).toEqual([
      ["09:00", "10:00"],
      ["11:00", "13:30"],
      ["16:30", "20:00"],
    ]);
    expect(minutesOf(left)).toBe(60 + 150 + 210);
  });

  it("los ocupados que se pisan entre sí no restan dos veces", () => {
    const left = subtractIntervals(
      [iv("2026-11-16T09:00:00Z", "2026-11-16T12:00:00Z")],
      [iv("2026-11-16T09:30:00Z", "2026-11-16T10:30:00Z"), iv("2026-11-16T10:00:00Z", "2026-11-16T11:00:00Z")],
    );
    expect(minutesOf(left)).toBe(30 + 60);
  });
});

describe("daySummary", () => {
  const shift = [iv("2026-11-16T09:00:00Z", "2026-11-16T14:00:00Z")];
  const day = (over: Partial<Parameters<typeof daySummary>[0]> = {}) => ({
    working: true, shifts: shift, timeOff: [], blocks: [], ...over,
  });

  it("no trabaja", () => {
    expect(daySummary(day({ working: false, shifts: [] }), []).summary).toEqual({ kind: "off" });
  });
  it("ausencia que tapa el turno entero", () => {
    expect(daySummary(day({ timeOff: [iv("2026-11-16T00:00:00Z", "2026-11-17T00:00:00Z")] }), []).summary)
      .toEqual({ kind: "absent" });
  });
  it("huecos libres, quitando citas y bloqueos", () => {
    const r = daySummary(
      day({ blocks: [iv("2026-11-16T13:00:00Z", "2026-11-16T14:00:00Z")] }),
      [iv("2026-11-16T09:00:00Z", "2026-11-16T10:30:00Z")],
    );
    expect(r.summary).toEqual({ kind: "free", minutes: 150 });
    expect(r.free.map((i) => i.start.toISOString().slice(11, 16))).toEqual(["10:30"]);
  });
  it("un hueco de 10 minutos no cuenta: completo", () => {
    const r = daySummary(day(), [
      iv("2026-11-16T09:00:00Z", "2026-11-16T11:00:00Z"),
      iv("2026-11-16T11:10:00Z", "2026-11-16T14:00:00Z"),
    ]);
    expect(r.summary).toEqual({ kind: "full" });
  });
});
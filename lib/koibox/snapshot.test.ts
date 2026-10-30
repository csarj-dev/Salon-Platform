import { describe, expect, it } from "vitest";
import { createKoiboxClient } from "./client";
import { createFakeKoibox } from "./fake";
import { RateLimiter } from "./limits";
import { loadKoiboxSnapshot } from "./snapshot";
import { KOIBOX_STATUS } from "./statuses";

const KEY = "clave";

function setup() {
  const fake = createFakeKoibox({
    [KEY]: {
      users: [{ id: 11, name: "Lucía", from: "10:00", to: "14:00", days: [1, 2, 3, 4, 5] }],
      services: [{ id: 501, name: "Lifting", duration: "01:00:00", userIds: [11] }],
      clients: [{ id: 900, nombre: "Laura", movil: "600000000" }],
      weekOverrides: [{ userId: 11, week: "45", year: "2026", days: { 1: ["16:00", "20:00"] } }],
      blocks: [
        { userId: 11, date: "2026-10-05", start: "12:00", end: "12:30", recurrence: "week_1___" }, // antiguo pero se repite
        { userId: 11, date: "2026-10-06", start: "10:00", end: "11:00" }, // antiguo y no se repite
        { userId: 11, date: "2026-11-03", start: "10:00", end: "11:00" },
      ],
    },
  });
  const api = createKoiboxClient({ apiKey: KEY, fetchImpl: fake.fetch, limiter: new RateLimiter(1000) });
  return { api, fake };
}

const booking = {
  titulo: "Cita",
  hora_inicio: "10:00:00",
  hora_fin: "11:00:00",
  user: 11,
  cliente: 900,
  servicios: [501],
  estado: KOIBOX_STATUS.PENDING,
};

describe("loadKoiboxSnapshot", () => {
  it("trae horarios (de siempre y de una semana), citas del rango y bloqueos que aún cuentan", async () => {
    const { api } = setup();
    await api.createAppointment({ ...booking, fecha: "2026-11-04" });
    const cancelled = await api.createAppointment({ ...booking, fecha: "2026-11-05" });
    await api.updateAppointment(cancelled.id, { estado: KOIBOX_STATUS.CANCELLED });
    await api.createAppointment({ ...booking, fecha: "2026-12-20" }); // fuera del rango

    const s = await loadKoiboxSnapshot(api, "2026-11-02", "2026-11-08");

    expect(s.schedules.map((r) => [r.user, r.week, r.year])).toEqual([
      [11, null, null],
      [11, "45", "2026"],
    ]);
    // La anulada no ocupa hueco
    expect(s.appointments).toEqual([{ userId: 11, date: "2026-11-04", start: "10:00:00", end: "11:00:00" }]);
    expect(s.blocks.map((b) => [b.date, b.recurrence])).toEqual([
      ["2026-10-05", "week_1___"],
      ["2026-11-03", "none"],
    ]);
  });

  it("los huecos libres del fake respetan horario de la semana y bloqueos", async () => {
    const { api } = setup();
    // Lunes 2 (semana 45): ese lunes trabaja de 16:00 a 20:00
    const monday = await api.availableTimes({ serviceIds: [501], date: "2026-11-02", userId: 11 });
    expect(monday[0].hora).toBe("16:00");
    // Lunes 9: horario de siempre, con el bloqueo semanal de 12:00 a 12:30
    const next = (await api.availableTimes({ serviceIds: [501], date: "2026-11-09", userId: 11 })).map((h) => h.hora);
    expect(next).toEqual(["10:00", "10:30", "11:00", "12:30", "13:00"]);
  });
});
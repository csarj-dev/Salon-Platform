import { afterEach, describe, expect, it } from "vitest";
import { getKoiboxClient, koiboxDriver, resetDevFakeKoibox } from "./driver";
import { KOIBOX_STATUS } from "./statuses";
import { refId } from "./types";

const config = {
  accounts: {
    salon: { label: "Cuenta del salón", keyEnv: "KOIBOX_KEY_SALON" },
    amanda: { label: "Cuenta de Amanda", keyEnv: "KOIBOX_KEY_AMANDA" },
  },
};

afterEach(() => resetDevFakeKoibox());

describe("koiboxDriver", () => {
  it("por defecto es el Koibox de mentira", () => {
    expect(koiboxDriver({})).toBe("fake");
    expect(koiboxDriver({ KOIBOX_DRIVER: "api" })).toBe("api");
  });

  it("rechaza un driver desconocido", () => {
    expect(() => koiboxDriver({ KOIBOX_DRIVER: "real" })).toThrow(/desconocido/);
  });
});

describe("getKoiboxClient", () => {
  it("con fake, cada cuenta es un centro distinto con sus datos de ejemplo", async () => {
    const salon = getKoiboxClient("salon", config, {});
    const amanda = getKoiboxClient("amanda", config, {});
    const [a, b] = await Promise.all([salon.me(), amanda.me()]);
    expect(a.centro).not.toBe(b.centro);
    expect((await salon.listServices()).length).toBeGreaterThan(0);
  });

  it("con fake, lo creado se ve después en la misma cuenta (mismo proceso)", async () => {
    const first = getKoiboxClient("salon", config, {});
    const [service] = await first.listServices();
    const client = await first.createClient({ nombre: "Ana", movil: "600000000" });
    const created = await first.createAppointment({
      titulo: "Prueba",
      fecha: "2026-11-05",
      hora_inicio: "09:00:00",
      hora_fin: "09:30:00",
      user: refId(service.users[0])!,
      cliente: client.id,
      servicios: [service.id],
      estado: KOIBOX_STATUS.PENDING,
    });
    const second = getKoiboxClient("salon", config, {});
    expect(await second.getAppointment(created.id)).not.toBeNull();
  });

  it("con api, exige la clave de esa cuenta y dice qué variable falta", () => {
    expect(() => getKoiboxClient("amanda", config, { KOIBOX_DRIVER: "api" })).toThrow(/KOIBOX_KEY_AMANDA/);
    expect(() =>
      getKoiboxClient("amanda", config, { KOIBOX_DRIVER: "api", KOIBOX_KEY_AMANDA: "k" }),
    ).not.toThrow();
  });

  it("rechaza una cuenta que no está en el config", () => {
    expect(() => getKoiboxClient("luz", config, {})).toThrow(/no está en el config/);
    expect(() => getKoiboxClient("salon", { accounts: {} }, {})).toThrow(/no tiene cuentas/);
  });
});
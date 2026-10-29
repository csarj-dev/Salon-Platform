// Qué Koibox se usa, como EMAIL_DRIVER con los correos:
//   KOIBOX_DRIVER=fake (por defecto): el Koibox de mentira en memoria, sin red ni clave.
//   KOIBOX_DRIVER=api: el Koibox real, con la clave de cada cuenta en su variable (KOIBOX_KEY_...).
import type { KoiboxConfig } from "../salon-config";
import { createKoiboxClient, type KoiboxApi } from "./client";
import { createFakeKoibox, demoSeed, type FakeKoibox } from "./fake";

export const KOIBOX_DRIVERS = ["fake", "api"] as const;
export type KoiboxDriver = (typeof KOIBOX_DRIVERS)[number];

export type KoiboxEnv = Record<string, string | undefined>;

export function koiboxDriver(env: KoiboxEnv = process.env): KoiboxDriver {
  const value = env.KOIBOX_DRIVER?.trim() || "fake";
  if (!(KOIBOX_DRIVERS as readonly string[]).includes(value)) {
    throw new Error(`KOIBOX_DRIVER desconocido: ${value} (usa fake o api)`);
  }
  return value as KoiboxDriver;
}

// Un solo Koibox de mentira por proceso, con un centro por cuenta del config.
// En Vercel cada instancia tiene el suyo y se vacía al reiniciar: es solo para probar.
let devFake: { fake: FakeKoibox; accounts: string } | null = null;

function fakeFor(accountIds: string[]): FakeKoibox {
  const signature = accountIds.join(",");
  if (!devFake || devFake.accounts !== signature) {
    const centers = Object.fromEntries(accountIds.map((id, i) => [fakeKey(id), demoSeed(id, i)]));
    devFake = { fake: createFakeKoibox(centers), accounts: signature };
  }
  return devFake.fake;
}

const fakeKey = (account: string) => `fake-key-${account}`;

// Cliente para una cuenta del salón ("salon", "amanda"...)
export function getKoiboxClient(account: string, config: KoiboxConfig, env: KoiboxEnv = process.env): KoiboxApi {
  const settings = config.accounts[account];
  if (!settings) {
    const known = Object.keys(config.accounts);
    throw new Error(
      known.length
        ? `La cuenta de Koibox "${account}" no está en el config (hay: ${known.join(", ")})`
        : "El salón no tiene cuentas de Koibox en el config (koibox.accounts)",
    );
  }

  if (koiboxDriver(env) === "fake") {
    const fake = fakeFor(Object.keys(config.accounts));
    return createKoiboxClient({ apiKey: fakeKey(account), fetchImpl: fake.fetch });
  }

  const apiKey = env[settings.keyEnv]?.trim();
  if (!apiKey) throw new Error(`Falta ${settings.keyEnv} (clave de Koibox de "${settings.label}")`);
  return createKoiboxClient({ apiKey });
}

// Solo para los tests: vacía el Koibox de mentira del proceso
export function resetDevFakeKoibox(): void {
  devFake = null;
}
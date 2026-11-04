// Quién cobra el depósito de una cita (el "cobrador") y cómo se le paga.
// Se elige de lo más concreto a lo más general:
//   1. el de la profesional (columna staff.collector), si lo tiene y existe en el config;
//   2. el de su cuenta de Koibox (koibox.accounts.<cuenta>.collector);
//   3. el cobrador por defecto (payments.defaultCollector, o el único que haya).
// Un salón sin payments.collectors tiene un solo cobrador con lo de booking.deposit.
// Lógica pura: sin base de datos. Guía para configurarlo: docs/collectors.md.
import type { DepositMode } from "./deposit";
import type { SalonConfig } from "./salon-config";

export type Collector = {
  id: string;
  label: string;
  deposit: {
    mode: DepositMode;
    whatsapp: string | null; // número al que pedir el enlace de pago (el suyo o el del salón)
    instructions: Record<string, string> | null; // cómo pagarle, por idioma
  };
};

// Id del cobrador único de un salón que no tiene payments.collectors
export const SINGLE_COLLECTOR_ID = "salon";

type CollectorsConfig = Pick<SalonConfig, "name" | "contact" | "booking" | "koibox" | "payments">;

export function salonCollectors(config: CollectorsConfig): { defaultId: string; byId: Map<string, Collector> } {
  const entries = Object.entries(config.payments.collectors);
  if (entries.length === 0) {
    const single: Collector = {
      id: SINGLE_COLLECTOR_ID,
      label: config.name,
      deposit: {
        mode: config.booking.deposit.mode,
        whatsapp: config.contact.whatsapp ?? null,
        instructions: config.booking.deposit.instructions ?? null,
      },
    };
    return { defaultId: single.id, byId: new Map([[single.id, single]]) };
  }

  const byId = new Map<string, Collector>(
    entries.map(([id, c]) => [
      id,
      {
        id,
        label: c.label,
        deposit: {
          mode: c.deposit.mode,
          whatsapp: c.deposit.whatsapp ?? config.contact.whatsapp ?? null,
          instructions: c.deposit.instructions ?? null,
        },
      },
    ]),
  );
  // El schema ya exige defaultCollector cuando hay más de uno
  return { defaultId: config.payments.defaultCollector ?? entries[0][0], byId };
}

// Lo que se sabe de la profesional de la cita
export type CollectorHints = {
  staffCollector?: string | null;
  koiboxAccount?: string | null;
};

export type CollectorChoice = {
  collector: Collector;
  // De dónde sale: de la profesional, de su cuenta de Koibox o el de por defecto
  source: "staff" | "account" | "default";
  // Un id guardado que ya no está en el config (se quitó ese cobrador): se ha saltado
  ignored: string | null;
};

// Igual que resolveCollector, pero explica de dónde sale (para db/collectors.ts y el panel)
export function chooseCollector(config: CollectorsConfig, hints: CollectorHints = {}): CollectorChoice {
  const { defaultId, byId } = salonCollectors(config);
  let ignored: string | null = null;

  // Un id que ya no está en el config se salta: no se rompe la cita
  if (hints.staffCollector) {
    const fromStaff = byId.get(hints.staffCollector);
    if (fromStaff) return { collector: fromStaff, source: "staff", ignored };
    ignored = hints.staffCollector;
  }
  const accountCollector = hints.koiboxAccount ? config.koibox.accounts[hints.koiboxAccount]?.collector : undefined;
  if (accountCollector) {
    const fromAccount = byId.get(accountCollector);
    if (fromAccount) return { collector: fromAccount, source: "account", ignored };
  }
  return { collector: byId.get(defaultId)!, source: "default", ignored };
}

export function resolveCollector(config: CollectorsConfig, hints: CollectorHints = {}): Collector {
  return chooseCollector(config, hints).collector;
}
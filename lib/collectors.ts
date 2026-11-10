// Quién cobra el depósito de una cita (el "cobrador") y cómo se le paga.
// Se elige de lo más concreto a lo más general:
//   1. el de la profesional (columna staff.collector), si lo tiene y existe en el config;
//   2. el de su cuenta de Koibox (koibox.accounts.<cuenta>.collector);
//   3. el cobrador por defecto (payments.defaultCollector, o el único que haya).
// Un salón sin payments.collectors tiene un solo cobrador: el salón, con instrucciones (que no
// lleva: la clienta ve "el salón te escribirá") y el WhatsApp del salón.
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

type CollectorsConfig = Pick<SalonConfig, "name" | "contact" | "koibox" | "payments">;

export function salonCollectors(config: CollectorsConfig): { defaultId: string; byId: Map<string, Collector> } {
  const entries = Object.entries(config.payments.collectors);
  if (entries.length === 0) {
    const single: Collector = {
      id: SINGLE_COLLECTOR_ID,
      label: config.name,
      deposit: { mode: "instructions", whatsapp: config.contact.whatsapp ?? null, instructions: null },
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
// ¿Cobra más de una persona? Entonces el equipo ve a quién se paga (panel, Koibox). La clienta, nunca.
  return { defaultId: config.payments.defaultCollector ?? entries[0][0], byId };
}

// ¿Cobra más de una persona? Entonces se dice a quién se paga (confirmación, panel, Koibox)
export function hasSeveralCollectors(config: CollectorsConfig): boolean {
  return Object.keys(config.payments.collectors).length > 1;
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

// ¿Es un cobrador de este salón? (para no guardar un id que no está en el config)
export function isSalonCollector(config: CollectorsConfig, id: string): boolean {
  return salonCollectors(config).byId.has(id);
}

export type StaffCollectorView = {
  choice: CollectorChoice; // quién cobra hoy y por qué
  fallback: Collector; // quién cobraría sin cobrador propio (su cuenta o el de por defecto)
};

// Para el panel de Cobros: lo que hay y lo que habría al dejarlo "según su cuenta"
export function staffCollectorView(config: CollectorsConfig, hints: CollectorHints = {}): StaffCollectorView {
  return {
    choice: chooseCollector(config, hints),
    fallback: chooseCollector(config, { koiboxAccount: hints.koiboxAccount }).collector,
  };
}
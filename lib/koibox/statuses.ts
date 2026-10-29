import type { KoiboxTag } from "./types";

// Estados de una cita en Koibox (respuesta de soporte de Koibox, octubre 2026).
// Los números son los de Koibox; los nombres, nuestros.
export const KOIBOX_STATUS = {
  COMPLETED: 1, // Realizada
  PENDING: 2, // Pendiente
  CANCELLED: 3, // Anulada
  NO_SHOW: 4, // Perdida (no vino)
  CANCELLED_BY_CLIENT: 5, // Anulada por el usuario
  UNCONFIRMED: 6, // Sin confirmación: obsoleto según Koibox, no lo usamos
  IN_PROGRESS: 7, // En proceso
  COMPLIMENTARY: 8, // Bonificada
  DELETED: 9, // Eliminada
} as const;

export type KoiboxStatus = (typeof KOIBOX_STATUS)[keyof typeof KOIBOX_STATUS];

// Estados con los que la cita ya no ocupa el hueco
const FREES_SLOT = new Set<number>([
  KOIBOX_STATUS.CANCELLED,
  KOIBOX_STATUS.CANCELLED_BY_CLIENT,
  KOIBOX_STATUS.DELETED,
]);

export function freesSlot(status: number | null): boolean {
  return status !== null && FREES_SLOT.has(status);
}

// Etiquetas que pone la web en la cita de Koibox, para que recepción vea de un vistazo
// cómo está el pago. Una cita lleva como mucho una de estas a la vez.
// El texto es lo que ve recepción en Koibox, por eso va en español.
export const WEB_TAG = {
  PAYMENT_PENDING: "Web · pago pendiente",
  DEPOSIT_PAID: "Web · depósito pagado",
  PAID_IN_FULL: "Web · pagada entera",
  DEPOSIT_SAVED: "Web · depósito guardado",
} as const;

export type WebTag = (typeof WEB_TAG)[keyof typeof WEB_TAG];

const WEB_TAG_NAMES = new Set<string>(Object.values(WEB_TAG));

// Cambia la etiqueta de la web y conserva las que haya puesto el salón a mano
export function withWebTag(current: KoiboxTag[] | undefined, next: WebTag): KoiboxTag[] {
  const own = (current ?? []).filter((t) => !WEB_TAG_NAMES.has(t.name));
  return [...own.map((t) => ({ name: t.name })), { name: next }];
}

// Texto de las notas de la cita en Koibox. Una línea por dato, para que recepción
// lo lea sin abrir nuestra app. `ref` es nuestro id de cita (para buscarla si hace falta).
export type AppointmentNoteInput = {
  ref: number;
  clientName: string;
  clientEmail?: string | null;
  lines?: string[]; // pagos, depósito guardado... (entregas siguientes)
};

export function buildAppointmentNotes(input: AppointmentNoteInput): string {
  const out = [`Reserva web #${input.ref}`, `Clienta: ${input.clientName}`];
  if (input.clientEmail) out.push(`Correo: ${input.clientEmail}`);
  for (const line of input.lines ?? []) {
    const clean = line.replace(/\s+/g, " ").trim();
    if (clean) out.push(clean);
  }
  return out.join("\n");
}
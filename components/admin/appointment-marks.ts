// Marcas de una cita, iguales en todo el panel: la pastilla de estado, la franja y el punto
// de Koibox. Las usan la tarjeta, la fila de la tabla y la ficha (y las usará la agenda).
import type { AppointmentStatus } from "@/lib/appointment-list";
import type { Tone } from "./panel-ui";

// Color de la pastilla de estado (colores del tema del salón)
export const STATUS_TONE: Record<AppointmentStatus, Tone> = {
  booked: "ok",
  pending_deposit: "wait",
  completed: "neutral",
  no_show: "bad",
  cancelled: "bad",
  expired: "bad",
};

// Koibox: verde = al día, ámbar = le falta algo, rojo = no está
export const KOIBOX_TONE = {
  synced: { box: "bg-success/10", dot: "bg-success" },
  pending: { box: "bg-warning/12", dot: "bg-warning" },
  missing: { box: "bg-danger/10", dot: "bg-danger" },
} as const;

// Columnas de la tabla de Citas (cabecera y filas): hora, clienta, servicio, estado,
// [Koibox,] botón. En el móvil no hay rejilla: cada fila se apila.
export const ROW_GRID_KOIBOX =
  "md:grid md:grid-cols-[5rem_minmax(0,1.2fr)_minmax(0,1.5fr)_10rem_8.5rem_3.5rem] md:items-center";
export const ROW_GRID_PLAIN =
  "md:grid md:grid-cols-[5rem_minmax(0,1.2fr)_minmax(0,1.5fr)_10rem_3.5rem] md:items-center";
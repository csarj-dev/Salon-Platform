// Formas de la API de Koibox que usamos (https://docs.koibox.cloud/en/api-ref/koibox/).
// Los nombres de los tipos son nuestros (inglés); los CAMPOS van en español porque son
// los que envía y espera Koibox. Solo están los que leemos o escribimos.
// Ojo: no hay sandbox. Los campos salen de la documentación y se confirman con la
// primera clave Platinum (npx tsx db/koibox-try.ts).

// Muchos campos llegan como objeto ({ value, text }) o como número, según el endpoint
export type KoiboxRef = number | { value?: number; id?: number; text?: string; nombre?: string };

// Página de resultados: Koibox devuelve como mucho 50 por página
export type KoiboxPage<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

// GET /api/api-key/me/
export type KoiboxKeyInfo = {
  name: string;
  centro: number;
  centro_slug: string;
};

// GET /api/servicios/
export type KoiboxService = {
  id: number;
  referencia?: string;
  nombre: string;
  duracion: string; // "01:00:00"
  precio?: string | number | null; // "45.00"
  is_active?: boolean;
  is_disponible_online?: boolean;
  secure_payment_amount?: number | null;
  users: KoiboxRef[]; // profesionales que lo hacen
};

// GET /api/agenda/horas-disponibles/
export type KoiboxAvailableTime = {
  user: number;
  hora: string; // "HH:mm"
};

// GET/POST /api/clientes/
export type KoiboxClient = {
  id: number;
  nombre: string;
  apellido1?: string | null;
  movil?: string | null;
  prefijo_tel?: string | null;
  email?: string | null;
};

export type KoiboxClientInput = {
  nombre: string;
  apellido1?: string;
  movil: string;
  prefijo_tel?: string;
  email?: string;
  // Avisos de la cita (recordatorios de Koibox): sí. Publicidad y encuestas: no,
  // porque la clienta no lo ha aceptado al reservar en la web.
  is_agree_notificaciones_email?: boolean;
  is_agree_notificaciones_sms?: boolean;
  is_suscrito_newsletter?: boolean;
  is_suscrito_encuestas?: boolean;
};

export type KoiboxTag = { id?: number; name: string };

// GET/POST /api/agenda/
export type KoiboxAppointment = {
  id: number;
  titulo: string;
  fecha: string; // "YYYY-MM-DD", hora local del centro
  hora_inicio: string; // "HH:mm:ss"
  hora_fin: string | null;
  notas?: string | null;
  user: KoiboxRef;
  cliente?: KoiboxRef | null;
  estado?: KoiboxRef | null;
  servicios?: unknown;
  tags?: KoiboxTag[];
  venta?: number | null;
  origen?: string;
};

export type KoiboxAppointmentInput = {
  titulo: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  user: number;
  cliente: number;
  servicios: number[];
  estado: number;
  notas?: string;
  tags?: KoiboxTag[];
};

// PATCH /api/agenda/{id}/ (Koibox confirmó por correo que existe aunque no salga en la web)
export type KoiboxAppointmentPatch = {
  estado?: number;
  notas?: string;
  tags?: KoiboxTag[];
};

// Saca el número de un campo que puede venir como objeto o como número
export function refId(ref: KoiboxRef | null | undefined): number | null {
  if (ref == null) return null;
  if (typeof ref === "number") return ref;
  return ref.value ?? ref.id ?? null;
}

// Y el nombre, si viene como objeto
export function refText(ref: KoiboxRef | null | undefined): string | null {
  if (ref == null || typeof ref === "number") return null;
  return ref.text ?? ref.nombre ?? null;
}
// Emparejar nuestro catálogo y equipo con lo que hay en Koibox, por nombre.
// Lo seguro (mismo nombre, sin dudas) se puede guardar solo; lo demás se enseña para enlazarlo
// a mano con db/koibox-link.ts. Lógica pura: sin red ni base de datos (ver db/koibox-match.ts).
import { refId, refText, type KoiboxService } from "./types";

// "Laminado  de Cejas!" -> "laminado de cejas" (sin tildes, mayúsculas ni signos)
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const STOPWORDS = new Set(["de", "del", "la", "las", "el", "los", "y", "con", "para", "en", "a"]);
const words = (name: string) => new Set(normalizeName(name).split(" ").filter((w) => w && !STOPWORDS.has(w)));

// ¿Se parecen? Comparten al menos la mitad de las palabras importantes, o unas contienen a las otras
// ("Laminado cejas" ~ "Laminado de cejas", "Lifting" ~ "Lifting de pestañas")
export function similarNames(a: string, b: string): boolean {
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return false;
  const common = [...wa].filter((w) => wb.has(w)).length;
  if (common === Math.min(wa.size, wb.size)) return true;
  return common / new Set([...wa, ...wb]).size >= 0.5;
}

// "01:00:00" -> 60
export function durationMinutes(duracion: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(duracion.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// ---- Servicios (por cuenta) ----

export type OurService = { id: number; name: string; durationMin: number };

export type ServicePlan = {
  account: string;
  link: { ours: OurService; theirs: KoiboxService }[]; // seguros: se guardan con --apply
  doubtful: { ours: OurService; theirs: KoiboxService[]; reason: string }[]; // mismo nombre, pero algo no cuadra
  suggestions: { ours: OurService; theirs: KoiboxService }[]; // nombre parecido
  alreadyLinked: number; // nuestros servicios que ya tienen id en esta cuenta
  missingInCatalog: KoiboxService[]; // de Koibox, sin pareja en nuestro catálogo
  inactive: number; // de Koibox, dados de baja (no se tienen en cuenta)
};

export function planServiceMatches(input: {
  account: string;
  ours: OurService[];
  theirs: KoiboxService[];
  linked: { serviceId: number; koiboxServiceId: number }[]; // enlaces que ya hay en esta cuenta
}): ServicePlan {
  const linkedOurs = new Set(input.linked.map((l) => l.serviceId));
  const linkedTheirs = new Set(input.linked.map((l) => l.koiboxServiceId));
  const active = input.theirs.filter((s) => s.is_active !== false);
  const free = active.filter((s) => !linkedTheirs.has(s.id));
  const pending = input.ours.filter((s) => !linkedOurs.has(s.id));

  // Quién reclama cada servicio de Koibox por nombre exacto (si son dos, ninguno es seguro)
  const exact = new Map(pending.map((o) => [o.id, free.filter((t) => normalizeName(t.nombre) === normalizeName(o.name))]));
  const claims = new Map<number, number>();
  for (const found of exact.values()) for (const t of found) claims.set(t.id, (claims.get(t.id) ?? 0) + 1);

  const plan: ServicePlan = {
    account: input.account,
    link: [],
    doubtful: [],
    suggestions: [],
    alreadyLinked: input.ours.length - pending.length,
    missingInCatalog: [],
    inactive: input.theirs.length - active.length,
  };
  const touched = new Set<number>();

  for (const ours of pending) {
    const found = exact.get(ours.id)!;
    found.forEach((t) => touched.add(t.id));
    if (found.length > 1) {
      plan.doubtful.push({ ours, theirs: found, reason: `hay ${found.length} servicios con ese nombre en Koibox` });
    } else if (found.length === 1) {
      const theirs = found[0];
      const minutes = durationMinutes(theirs.duracion);
      if ((claims.get(theirs.id) ?? 0) > 1) {
        plan.doubtful.push({ ours, theirs: found, reason: "otro servicio nuestro tiene el mismo nombre" });
      } else if (minutes !== ours.durationMin) {
        plan.doubtful.push({
          ours,
          theirs: found,
          reason: `dura ${ours.durationMin} min aquí y ${minutes ?? theirs.duracion} min en Koibox`,
        });
      } else {
        plan.link.push({ ours, theirs });
      }
    } else {
      for (const theirs of free.filter((t) => similarNames(t.nombre, ours.name))) {
        plan.suggestions.push({ ours, theirs });
        touched.add(theirs.id);
      }
    }
  }
  plan.missingInCatalog = free.filter((t) => !touched.has(t.id));
  return plan;
}

// ---- Profesionales (en todas las cuentas a la vez: cada una está en una sola) ----

export type KoiboxUser = { account: string; id: number; name: string };

// Koibox no tiene lista de empleadas: salen de quién hace cada servicio
export function koiboxUsersOf(account: string, services: KoiboxService[]): KoiboxUser[] {
  const users = new Map<number, KoiboxUser>();
  for (const s of services) {
    for (const u of s.users ?? []) {
      const id = refId(u);
      const name = refText(u);
      if (id !== null && name && !users.has(id)) users.set(id, { account, id, name });
    }
  }
  return [...users.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export type OurStaff = { id: number; name: string; koiboxAccount: string | null; koiboxUserId: number | null };

export type StaffPlan = {
  link: { ours: OurStaff; theirs: KoiboxUser }[];
  doubtful: { ours: OurStaff; theirs: KoiboxUser[]; reason: string }[];
  suggestions: { ours: OurStaff; theirs: KoiboxUser }[];
  alreadyLinked: number;
  unmatchedUsers: KoiboxUser[]; // usuarias de Koibox que no son nadie de nuestro equipo (aún)
};

export function planStaffMatches(ours: OurStaff[], users: KoiboxUser[]): StaffPlan {
  const key = (account: string, id: number) => `${account}/${id}`;
  const taken = new Set(ours.filter((o) => o.koiboxAccount && o.koiboxUserId !== null).map((o) => key(o.koiboxAccount!, o.koiboxUserId!)));
  const free = users.filter((u) => !taken.has(key(u.account, u.id)));
  const pending = ours.filter((o) => !o.koiboxAccount);

  const exact = new Map(pending.map((o) => [o.id, free.filter((u) => normalizeName(u.name) === normalizeName(o.name))]));
  const claims = new Map<string, number>();
  for (const found of exact.values()) for (const u of found) claims.set(key(u.account, u.id), (claims.get(key(u.account, u.id)) ?? 0) + 1);

  const plan: StaffPlan = { link: [], doubtful: [], suggestions: [], alreadyLinked: ours.length - pending.length, unmatchedUsers: [] };
  const touched = new Set<string>();
  const firstWord = (name: string) => normalizeName(name).split(" ")[0];

  for (const o of pending) {
    const found = exact.get(o.id)!;
    found.forEach((u) => touched.add(key(u.account, u.id)));
    if (found.length > 1) {
      const where = found.map((u) => `${u.account} ${u.id}`).join(", ");
      plan.doubtful.push({ ours: o, theirs: found, reason: `hay ${found.length} usuarias con ese nombre (${where})` });
    } else if (found.length === 1) {
      if ((claims.get(key(found[0].account, found[0].id)) ?? 0) > 1) {
        plan.doubtful.push({ ours: o, theirs: found, reason: "otra profesional nuestra tiene el mismo nombre" });
      } else {
        plan.link.push({ ours: o, theirs: found[0] });
      }
    } else {
      // "Ana" ~ "Ana García": mismo nombre de pila
      for (const u of free.filter((u) => firstWord(u.name) === firstWord(o.name))) {
        plan.suggestions.push({ ours: o, theirs: u });
        touched.add(key(u.account, u.id));
      }
    }
  }
  plan.unmatchedUsers = free.filter((u) => !touched.has(key(u.account, u.id)));
  return plan;
}
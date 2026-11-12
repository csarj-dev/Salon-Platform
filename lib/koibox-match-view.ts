// La propuesta de emparejar con Koibox, en plano para enseñarla en el panel
// (una línea por posible enlace). La propuesta la calcula lib/koibox-match-db.ts.
import { durationMinutes } from "./koibox/match";
import type { MatchPlan } from "./koibox-match-db";

export type MatchKind = "staff" | "service";

export type MatchItem = {
  kind: MatchKind;
  ourId: number;
  ourName: string;
  account: string;
  theirId: number;
  theirName: string;
  minutes: number | null; // servicios: lo que dura en Koibox
  reason: string | null; // en "Revisar": por qué no es seguro
};

export type UnmatchedItem = { kind: MatchKind; account: string; theirId: number; theirName: string; minutes: number | null };

export type MatchView = {
  errors: { account: string; message: string }[];
  alreadyLinked: number; // profesionales y servicios que ya tenían enlace (no se tocan)
  safe: MatchItem[];
  review: MatchItem[];
  similar: MatchItem[];
  unmatched: UnmatchedItem[];
};

type Plan = MatchPlan;
type StaffOurs = Plan["staff"]["link"][number]["ours"];
type StaffTheirs = Plan["staff"]["link"][number]["theirs"];
type ServiceOurs = Plan["services"][number]["link"][number]["ours"];
type ServiceTheirs = Plan["services"][number]["link"][number]["theirs"];

const staffItem = (ours: StaffOurs, theirs: StaffTheirs, reason: string | null = null): MatchItem => ({
  kind: "staff",
  ourId: ours.id,
  ourName: ours.name,
  account: theirs.account,
  theirId: theirs.id,
  theirName: theirs.name,
  minutes: null,
  reason,
});

const serviceItem = (account: string, ours: ServiceOurs, theirs: ServiceTheirs, reason: string | null = null): MatchItem => ({
  kind: "service",
  ourId: ours.id,
  ourName: ours.name,
  account,
  theirId: theirs.id,
  theirName: theirs.nombre,
  minutes: durationMinutes(theirs.duracion),
  reason,
});

export function matchPlanView(plan: Plan): MatchView {
  const s = plan.staff;
  return {
    errors: plan.errors,
    alreadyLinked: s.alreadyLinked + plan.services.reduce((n, p) => n + p.alreadyLinked, 0),
    safe: [
      ...s.link.map((l) => staffItem(l.ours, l.theirs)),
      ...plan.services.flatMap((p) => p.link.map((l) => serviceItem(p.account, l.ours, l.theirs))),
    ],
    // Una línea por candidato: así cada uno tiene su botón "Enlazar"
    review: [
      ...s.doubtful.flatMap((d) => d.theirs.map((t) => staffItem(d.ours, t, d.reason))),
      ...plan.services.flatMap((p) => p.doubtful.flatMap((d) => d.theirs.map((t) => serviceItem(p.account, d.ours, t, d.reason)))),
    ],
    similar: [
      ...s.suggestions.map((x) => staffItem(x.ours, x.theirs)),
      ...plan.services.flatMap((p) => p.suggestions.map((x) => serviceItem(p.account, x.ours, x.theirs))),
    ],
    unmatched: [
      ...s.unmatchedUsers.map((u) => ({ kind: "staff" as const, account: u.account, theirId: u.id, theirName: u.name, minutes: null })),
      ...plan.services.flatMap((p) =>
        p.missingInCatalog.map((t) => ({
          kind: "service" as const,
          account: p.account,
          theirId: t.id,
          theirName: t.nombre,
          minutes: durationMinutes(t.duracion),
        })),
      ),
    ],
  };
}
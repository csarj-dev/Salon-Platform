import { describe, expect, it } from "vitest";
import { matchPlanView } from "./koibox-match-view";
import type { MatchPlan } from "./koibox-match-db";

const svc = (id: number, nombre: string, duracion: string) => ({ id, nombre, duracion, users: [] });
const ours = (id: number, name: string, durationMin = 60) => ({ id, name, durationMin });
const staffOurs = (id: number, name: string) => ({ id, name, koiboxAccount: null, koiboxUserId: null });

const plan: MatchPlan = {
  errors: [{ account: "luz", message: "Koibox no responde" }],
  staff: {
    link: [{ ours: staffOurs(1, "Ana"), theirs: { account: "salon", id: 11, name: "Ana" } }],
    doubtful: [
      {
        ours: staffOurs(2, "Marta"),
        theirs: [{ account: "salon", id: 12, name: "Marta" }, { account: "amanda", id: 7, name: "Marta" }],
        reason: "hay 2 usuarias con ese nombre",
      },
    ],
    suggestions: [{ ours: staffOurs(3, "Lucía"), theirs: { account: "salon", id: 13, name: "Lucía García" } }],
    alreadyLinked: 0,
    unmatchedUsers: [{ account: "salon", id: 14, name: "Nerea" }],
  },
  services: [
    {
      account: "salon",
      link: [{ ours: ours(10, "Laminado de cejas"), theirs: svc(501, "Laminado de Cejas", "01:00:00") }],
      doubtful: [{ ours: ours(11, "Diseño de cejas", 30), theirs: [svc(502, "Diseño de cejas", "00:45:00")], reason: "dura 30 min aquí y 45 min en Koibox" }],
      suggestions: [],
      alreadyLinked: 0,
      missingInCatalog: [svc(503, "Tinte de pestañas", "00:30:00")],
      inactive: 0,
    },
  ],
};

describe("matchPlanView", () => {
  it("pasa la propuesta a una línea por enlace posible", () => {
    const v = matchPlanView(plan);
    expect(v.errors).toEqual([{ account: "luz", message: "Koibox no responde" }]);
    expect(v.safe.map((i) => [i.kind, i.ourName, i.account, i.theirId, i.minutes])).toEqual([
      ["staff", "Ana", "salon", 11, null],
      ["service", "Laminado de cejas", "salon", 501, 60],
    ]);
  });

  it("en Revisar, un candidato por línea con su motivo", () => {
    const v = matchPlanView(plan);
    expect(v.review.map((i) => [i.ourName, i.account, i.theirId, i.reason])).toEqual([
      ["Marta", "salon", 12, "hay 2 usuarias con ese nombre"],
      ["Marta", "amanda", 7, "hay 2 usuarias con ese nombre"],
      ["Diseño de cejas", "salon", 502, "dura 30 min aquí y 45 min en Koibox"],
    ]);
  });

  it("parecidos y lo que en Koibox no tiene pareja", () => {
    const v = matchPlanView(plan);
    expect(v.similar.map((i) => [i.ourName, i.theirName])).toEqual([["Lucía", "Lucía García"]]);
    expect(v.unmatched).toEqual([
      { kind: "staff", account: "salon", theirId: 14, theirName: "Nerea", minutes: null },
      { kind: "service", account: "salon", theirId: 503, theirName: "Tinte de pestañas", minutes: 30 },
    ]);
  });
});
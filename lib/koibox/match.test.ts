import { describe, expect, it } from "vitest";
import {
  durationMinutes, koiboxUsersOf, normalizeName, planServiceMatches, planStaffMatches, similarNames,
  type OurStaff,
} from "./match";
import type { KoiboxService } from "./types";

const svc = (id: number, nombre: string, duracion = "01:00:00", extra: Partial<KoiboxService> = {}): KoiboxService => ({
  id, nombre, duracion, users: [], ...extra,
});

describe("nombres", () => {
  it("normaliza tildes, mayúsculas, signos y espacios", () => {
    expect(normalizeName("  Diseño de  CEJAS! ")).toBe("diseno de cejas");
    expect(normalizeName("Lifting + tinte (pestañas)")).toBe("lifting tinte pestanas");
  });

  it("parecidos: comparten las palabras importantes o unas contienen a las otras", () => {
    expect(similarNames("Laminado cejas", "Laminado de cejas")).toBe(true);
    expect(similarNames("Lifting", "Lifting de pestañas")).toBe(true);
    expect(similarNames("Laminado de cejas", "Diseño de cejas")).toBe(false); // solo comparten "cejas"
    expect(similarNames("Laminado de cejas", "Microblading")).toBe(false);
    expect(similarNames("De la", "Lifting")).toBe(false); // solo palabras vacías
  });

  it("duración de Koibox en minutos", () => {
    expect(durationMinutes("01:30:00")).toBe(90);
    expect(durationMinutes("00:45")).toBe(45);
    expect(durationMinutes("hora y media")).toBeNull();
  });
});

describe("planServiceMatches", () => {
  const ours = [
    { id: 1, name: "Laminado de cejas", durationMin: 60 },
    { id: 2, name: "Diseño de cejas", durationMin: 30 },
    { id: 3, name: "Lifting de pestañas", durationMin: 75 },
    { id: 4, name: "Microblading", durationMin: 120 },
    { id: 5, name: "Maquillaje", durationMin: 60 },
  ];

  it("separa lo seguro, lo dudoso, lo parecido y lo que falta en nuestro catálogo", () => {
    const plan = planServiceMatches({
      account: "salon",
      ours,
      theirs: [
        svc(101, "LAMINADO DE CEJAS"), // seguro
        svc(102, "Diseño de cejas", "00:45:00"), // mismo nombre, otra duración
        svc(103, "Lifting pestañas", "01:15:00"), // parecido
        svc(104, "Microblading"), // ya enlazado
        svc(105, "Tinte de pestañas", "00:30:00"), // no está en nuestro catálogo
        svc(106, "Maquillaje", "01:00:00", { is_active: false }), // dado de baja en Koibox
      ],
      linked: [{ serviceId: 4, koiboxServiceId: 104 }],
    });
    expect(plan.link.map((l) => [l.ours.id, l.theirs.id])).toEqual([[1, 101]]);
    expect(plan.doubtful.map((d) => [d.ours.id, d.theirs.map((t) => t.id), d.reason])).toEqual([
      [2, [102], "dura 30 min aquí y 45 min en Koibox"],
    ]);
    expect(plan.suggestions.map((s) => [s.ours.id, s.theirs.id])).toEqual([[3, 103]]);
    expect(plan.missingInCatalog.map((s) => s.id)).toEqual([105]);
    expect(plan.alreadyLinked).toBe(1);
    expect(plan.inactive).toBe(1);
  });

  it("dos servicios de Koibox con el mismo nombre: no se elige ninguno solo", () => {
    const plan = planServiceMatches({
      account: "salon",
      ours: [ours[0]],
      theirs: [svc(101, "Laminado de cejas"), svc(201, "Laminado de Cejas")],
      linked: [],
    });
    expect(plan.link).toEqual([]);
    expect(plan.doubtful[0].reason).toBe("hay 2 servicios con ese nombre en Koibox");
  });

  it("dos servicios nuestros con el mismo nombre: tampoco", () => {
    const plan = planServiceMatches({
      account: "salon",
      ours: [ours[0], { ...ours[0], id: 9 }],
      theirs: [svc(101, "Laminado de cejas")],
      linked: [],
    });
    expect(plan.link).toEqual([]);
    expect(plan.doubtful.map((d) => d.reason)).toEqual([
      "otro servicio nuestro tiene el mismo nombre",
      "otro servicio nuestro tiene el mismo nombre",
    ]);
  });

  it("un servicio de Koibox ya enlazado con otro nuestro no se vuelve a proponer", () => {
    const plan = planServiceMatches({
      account: "salon",
      ours: [ours[0], { id: 9, name: "Laminado de cejas", durationMin: 60 }],
      theirs: [svc(101, "Laminado de cejas")],
      linked: [{ serviceId: 9, koiboxServiceId: 101 }],
    });
    expect(plan.link).toEqual([]);
    expect(plan.missingInCatalog).toEqual([]);
  });
});

describe("profesionales", () => {
  const services = [
    svc(1, "A", "01:00:00", { users: [{ value: 11, text: "Lucía Pérez" }, { value: 12, text: "Ana" }] }),
    svc(2, "B", "01:00:00", { users: [{ value: 12, text: "Ana" }, 13] }), // un id sin nombre se ignora
  ];

  it("las usuarias de Koibox salen de quién hace cada servicio, sin repetir", () => {
    expect(koiboxUsersOf("salon", services)).toEqual([
      { account: "salon", id: 12, name: "Ana" },
      { account: "salon", id: 11, name: "Lucía Pérez" },
    ]);
  });

  const staff = (id: number, name: string, koiboxAccount: string | null = null, koiboxUserId: number | null = null): OurStaff => ({
    id, name, koiboxAccount, koiboxUserId,
  });

  it("nombre exacto: seguro; mismo nombre de pila: sugerencia; ya enlazadas: se cuentan", () => {
    const users = [...koiboxUsersOf("salon", services), { account: "amanda", id: 7, name: "Amanda Ruiz" }];
    const plan = planStaffMatches(
      [staff(1, "Ana"), staff(2, "Lucía"), staff(3, "Amanda Ruiz", "amanda", 7), staff(4, "Nerea")],
      users,
    );
    expect(plan.link.map((l) => [l.ours.id, l.theirs.account, l.theirs.id])).toEqual([[1, "salon", 12]]);
    expect(plan.suggestions.map((s) => [s.ours.id, s.theirs.id])).toEqual([[2, 11]]);
    expect(plan.alreadyLinked).toBe(1);
    expect(plan.unmatchedUsers).toEqual([]);
  });

  it("el mismo nombre en dos cuentas: dudoso", () => {
    const plan = planStaffMatches(
      [staff(1, "Ana")],
      [{ account: "salon", id: 12, name: "Ana" }, { account: "amanda", id: 5, name: "ana" }],
    );
    expect(plan.link).toEqual([]);
    expect(plan.doubtful[0].reason).toBe("hay 2 usuarias con ese nombre (salon 12, amanda 5)");
  });
});
import { describe, expect, it } from "vitest";
import { linkReport, resolveKoiboxTarget, type ServiceKoiboxLink, type StaffKoiboxLink } from "./routing";

const accounts = ["salon", "amanda", "luz"];

const lucia: StaffKoiboxLink = { staffId: 2, staffName: "Lucía", koiboxAccount: "salon", koiboxUserId: 11 };
const amanda: StaffKoiboxLink = { staffId: 1, staffName: "Amanda", koiboxAccount: "amanda", koiboxUserId: 7 };
const nueva: StaffKoiboxLink = { staffId: 3, staffName: "Nerea", koiboxAccount: null, koiboxUserId: null };

// Lifting (servicio 10) tiene un id distinto en cada cuenta
const links: ServiceKoiboxLink[] = [
  { serviceId: 10, account: "salon", koiboxServiceId: 501 },
  { serviceId: 10, account: "amanda", koiboxServiceId: 77 },
];

describe("resolveKoiboxTarget", () => {
  it("va a la cuenta de quien hace el servicio, con el id de servicio de esa cuenta", () => {
    expect(resolveKoiboxTarget(lucia, 10, links, accounts)).toEqual({
      ok: true,
      target: { account: "salon", koiboxUserId: 11, koiboxServiceId: 501 },
    });
    expect(resolveKoiboxTarget(amanda, 10, links, accounts)).toEqual({
      ok: true,
      target: { account: "amanda", koiboxUserId: 7, koiboxServiceId: 77 },
    });
  });

  it("avisa si la profesional no está enlazada", () => {
    expect(resolveKoiboxTarget(nueva, 10, links, accounts)).toMatchObject({ ok: false, problem: "staff_not_linked" });
  });

  it("avisa si su cuenta ya no está en el config", () => {
    expect(resolveKoiboxTarget({ ...lucia, koiboxAccount: "vieja" }, 10, links, accounts)).toMatchObject({
      ok: false,
      problem: "unknown_account",
    });
  });

  it("avisa si el servicio no tiene id en esa cuenta y dice cómo arreglarlo", () => {
    const r = resolveKoiboxTarget(lucia, 20, links, accounts);
    expect(r).toMatchObject({ ok: false, problem: "service_not_linked" });
    if (!r.ok) expect(r.message).toContain("koibox-link.ts service 20 --account salon");
  });
});

describe("linkReport", () => {
  it("lista lo que falta por enlazar", () => {
    const report = linkReport({
      staff: [
        { ...lucia, serviceIds: [10, 20] },
        { ...amanda, serviceIds: [10, 20] },
        { ...nueva, serviceIds: [10] },
        { staffId: 4, staffName: "Irene", koiboxAccount: "vieja", koiboxUserId: 9, serviceIds: [] },
      ],
      services: [
        { id: 10, name: "Lifting" },
        { id: 20, name: "Cejas" },
      ],
      serviceLinks: links,
      accountIds: accounts,
    });
    expect(report.unlinkedStaff).toEqual([{ staffId: 3, staffName: "Nerea" }]);
    expect(report.unknownAccounts).toEqual([{ staffId: 4, staffName: "Irene", account: "vieja" }]);
    expect(report.missingServices).toEqual([
      { serviceId: 20, serviceName: "Cejas", account: "amanda", staffNames: ["Amanda"] },
      { serviceId: 20, serviceName: "Cejas", account: "salon", staffNames: ["Lucía"] },
    ]);
  });
});
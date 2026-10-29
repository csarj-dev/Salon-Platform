// A qué cuenta de Koibox va cada cita: a la de quien hace el servicio.
// Lucía (empleada) -> cuenta del salón; Amanda -> cuenta de Amanda. Lógica pura, sin base de datos.

export type StaffKoiboxLink = {
  staffId: number;
  staffName: string;
  koiboxAccount: string | null;
  koiboxUserId: number | null;
};

export type ServiceKoiboxLink = {
  serviceId: number;
  account: string;
  koiboxServiceId: number;
};

export type KoiboxTarget = {
  account: string;
  koiboxUserId: number; // la profesional en esa cuenta
  koiboxServiceId: number; // el servicio en esa cuenta
};

export type RoutingProblem = "staff_not_linked" | "unknown_account" | "service_not_linked";

export type RoutingResult =
  | { ok: true; target: KoiboxTarget }
  | { ok: false; problem: RoutingProblem; message: string };

export function resolveKoiboxTarget(
  staff: StaffKoiboxLink,
  serviceId: number,
  serviceLinks: ServiceKoiboxLink[],
  accountIds: string[],
): RoutingResult {
  if (!staff.koiboxAccount || staff.koiboxUserId === null) {
    return {
      ok: false,
      problem: "staff_not_linked",
      message: `${staff.staffName} no tiene cuenta de Koibox (npx tsx db/koibox-link.ts staff ${staff.staffId} --account ... --user ...)`,
    };
  }
  if (!accountIds.includes(staff.koiboxAccount)) {
    return {
      ok: false,
      problem: "unknown_account",
      message: `${staff.staffName} está en la cuenta "${staff.koiboxAccount}", que ya no está en el config`,
    };
  }
  const link = serviceLinks.find((l) => l.serviceId === serviceId && l.account === staff.koiboxAccount);
  if (!link) {
    return {
      ok: false,
      problem: "service_not_linked",
      message: `El servicio ${serviceId} no tiene id en la cuenta "${staff.koiboxAccount}" (npx tsx db/koibox-link.ts service ${serviceId} --account ${staff.koiboxAccount} --koibox ...)`,
    };
  }
  return {
    ok: true,
    target: { account: staff.koiboxAccount, koiboxUserId: staff.koiboxUserId, koiboxServiceId: link.koiboxServiceId },
  };
}

// Qué falta por enlazar antes de conectar la reserva: profesionales sin cuenta y servicios
// que hace alguien de una cuenta pero no tienen id en esa cuenta.
export type LinkReport = {
  unlinkedStaff: { staffId: number; staffName: string }[];
  unknownAccounts: { staffId: number; staffName: string; account: string }[];
  missingServices: { serviceId: number; serviceName: string; account: string; staffNames: string[] }[];
};

export function linkReport(input: {
  staff: (StaffKoiboxLink & { serviceIds: number[] })[];
  services: { id: number; name: string }[];
  serviceLinks: ServiceKoiboxLink[];
  accountIds: string[];
}): LinkReport {
  const report: LinkReport = { unlinkedStaff: [], unknownAccounts: [], missingServices: [] };
  const missing = new Map<string, LinkReport["missingServices"][number]>();

  for (const member of input.staff) {
    if (!member.koiboxAccount || member.koiboxUserId === null) {
      report.unlinkedStaff.push({ staffId: member.staffId, staffName: member.staffName });
      continue;
    }
    if (!input.accountIds.includes(member.koiboxAccount)) {
      report.unknownAccounts.push({ staffId: member.staffId, staffName: member.staffName, account: member.koiboxAccount });
      continue;
    }
    for (const serviceId of member.serviceIds) {
      const linked = input.serviceLinks.some((l) => l.serviceId === serviceId && l.account === member.koiboxAccount);
      if (linked) continue;
      const key = `${serviceId}/${member.koiboxAccount}`;
      const entry = missing.get(key) ?? {
        serviceId,
        serviceName: input.services.find((s) => s.id === serviceId)?.name ?? `#${serviceId}`,
        account: member.koiboxAccount,
        staffNames: [],
      };
      entry.staffNames.push(member.staffName);
      missing.set(key, entry);
    }
  }

  report.missingServices = [...missing.values()].sort(
    (a, b) => a.account.localeCompare(b.account) || a.serviceName.localeCompare(b.serviceName),
  );
  return report;
}
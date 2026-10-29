// Enlaza nuestras profesionales y servicios con sus ids en Koibox.
// Koibox no tiene endpoint de empleadas: los ids se ven con db/koibox-try.ts o en Koibox.
// Ejecutar con npx (npm run rompe las opciones en Windows):
//   npx tsx db/koibox-link.ts list
//   npx tsx db/koibox-link.ts staff 3 --account salon --user 1234
//   npx tsx db/koibox-link.ts service 7 --account salon --koibox 5678
import "dotenv/config";
import { and, asc, eq } from "drizzle-orm";
import { db, pgClient } from "./index";
import { koiboxServiceMap, service, staff, staffService } from "./schema";
import { loadSalonConfig } from "../lib/salon-config";
import { parseKoiboxLinkArgs } from "../lib/koibox-cli";
import { linkReport } from "../lib/koibox/routing";

// Código de Postgres para "ya existe" (índice único)
const UNIQUE_VIOLATION = "23505";

async function main() {
  const config = await loadSalonConfig();
  const accountIds = Object.keys(config.koibox.accounts);
  const args = parseKoiboxLinkArgs(process.argv.slice(2), accountIds);

  if (args.kind === "list") return printList(accountIds);

  if (args.kind === "staff" || args.kind === "staff-clear") {
    const [member] = await db.select({ id: staff.id, name: staff.name }).from(staff).where(eq(staff.id, args.staffId));
    if (!member) throw new Error(`No existe staff con id ${args.staffId}`);

    const set =
      args.kind === "staff"
        ? { koiboxAccount: args.account, koiboxUserId: args.userId }
        : { koiboxAccount: null, koiboxUserId: null };
    try {
      await db.update(staff).set(set).where(eq(staff.id, member.id));
    } catch (error) {
      if (pgCode(error) === UNIQUE_VIOLATION && args.kind === "staff") {
        throw new Error(`La usuaria ${args.userId} de la cuenta "${args.account}" ya está enlazada con otra profesional`);
      }
      throw error;
    }
    console.log(
      args.kind === "staff"
        ? `${member.name} (id ${member.id}) → cuenta "${args.account}", usuaria ${args.userId} de Koibox.`
        : `${member.name} (id ${member.id}) ya no está enlazada con Koibox.`,
    );
    return;
  }

  const [svc] = await db.select({ id: service.id, name: service.name }).from(service).where(eq(service.id, args.serviceId));
  if (!svc) throw new Error(`No existe servicio con id ${args.serviceId}`);

  if (args.kind === "service") {
    await db
      .insert(koiboxServiceMap)
      .values({ serviceId: svc.id, account: args.account, koiboxServiceId: args.koiboxServiceId })
      .onConflictDoUpdate({
        target: [koiboxServiceMap.serviceId, koiboxServiceMap.account],
        set: { koiboxServiceId: args.koiboxServiceId },
      });
    console.log(`${svc.name} (id ${svc.id}) → servicio ${args.koiboxServiceId} en la cuenta "${args.account}".`);
  } else {
    await db
      .delete(koiboxServiceMap)
      .where(and(eq(koiboxServiceMap.serviceId, svc.id), eq(koiboxServiceMap.account, args.account)));
    console.log(`${svc.name} (id ${svc.id}) ya no tiene id en la cuenta "${args.account}".`);
  }
}

async function printList(accountIds: string[]) {
  const team = await db
    .select({ id: staff.id, name: staff.name, account: staff.koiboxAccount, userId: staff.koiboxUserId })
    .from(staff)
    .where(eq(staff.active, true))
    .orderBy(asc(staff.name));
  const skills = await db.select().from(staffService);
  const services = await db.select({ id: service.id, name: service.name }).from(service).orderBy(asc(service.name));
  const links = await db.select().from(koiboxServiceMap);

  console.log("Profesionales:");
  for (const m of team) {
    console.log(`  ${m.id}  ${m.name}  ${m.account ? `→ ${m.account} / usuaria ${m.userId}` : "(sin enlazar)"}`);
  }
  console.log("\nServicios con id en Koibox:");
  if (links.length === 0) console.log("  (ninguno)");
  for (const l of links) {
    const name = services.find((s) => s.id === l.serviceId)?.name ?? `#${l.serviceId}`;
    console.log(`  ${l.serviceId}  ${name}  → ${l.account} / servicio ${l.koiboxServiceId}`);
  }

  const report = linkReport({
    staff: team.map((m) => ({
      staffId: m.id,
      staffName: m.name,
      koiboxAccount: m.account,
      koiboxUserId: m.userId,
      serviceIds: skills.filter((s) => s.staffId === m.id).map((s) => s.serviceId),
    })),
    services,
    serviceLinks: links,
    accountIds,
  });

  const pending = report.unlinkedStaff.length + report.unknownAccounts.length + report.missingServices.length;
  console.log(pending === 0 ? "\nTodo enlazado." : "\nFalta:");
  for (const s of report.unlinkedStaff) console.log(`  · ${s.staffName} (id ${s.staffId}) sin cuenta de Koibox`);
  for (const s of report.unknownAccounts) console.log(`  · ${s.staffName} (id ${s.staffId}) en la cuenta "${s.account}", que no está en el config`);
  for (const s of report.missingServices) {
    console.log(`  · ${s.serviceName} (id ${s.serviceId}) sin id en "${s.account}" (lo hace ${s.staffNames.join(", ")})`);
  }
}

function pgCode(error: unknown): string | undefined {
  // drizzle envuelve el error de postgres en `cause`
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pgClient.end());
// Empareja nuestras profesionales y servicios con los de Koibox por nombre.
// Sin opciones solo enseña la propuesta; con --apply guarda lo seguro (mismo nombre, sin dudas)
// y nunca cambia un enlace que ya exista. Lo demás se enlaza a mano con db/koibox-link.ts.
// Ejecutar con npx (npm run rompe las opciones en Windows):
//   npx tsx db/koibox-match.ts
//   npx tsx db/koibox-match.ts --apply
// Con KOIBOX_DRIVER=fake (por defecto) habla con el Koibox de mentira; con api, con el real.
import "dotenv/config";
import { pgClient } from "./index";
import { durationMinutes } from "../lib/koibox/match";
import { koiboxDriver } from "../lib/koibox/driver";
import { applyKoiboxMatches, planKoiboxMatches } from "../lib/koibox-match-db";
import { koiboxApiFor } from "../lib/koibox-sync";
import { loadSalonConfig } from "../lib/salon-config";

const minutes = (duracion: string) => `${durationMinutes(duracion) ?? duracion} min`;

async function main() {
  const args = process.argv.slice(2);
  if (args.some((a) => a !== "--apply")) throw new Error("Uso: npx tsx db/koibox-match.ts [--apply]");
  const config = await loadSalonConfig();
  if (Object.keys(config.koibox.accounts).length === 0) throw new Error("El salón no tiene cuentas de Koibox en el config");

  console.log(`Koibox: driver "${koiboxDriver()}"\n`);
  const plan = await planKoiboxMatches(config, koiboxApiFor(config));
  for (const e of plan.errors) console.log(`✗ La cuenta "${e.account}" no respondió: ${e.message}\n`);

  const s = plan.staff;
  console.log(`━━ Profesionales (${s.alreadyLinked} ya enlazadas)`);
  for (const { ours, theirs } of s.link) console.log(`  ✓ ${ours.name} (${ours.id}) → ${theirs.account} / usuaria ${theirs.id} "${theirs.name}"`);
  for (const d of s.doubtful) console.log(`  ? ${d.ours.name} (${d.ours.id}): ${d.reason}`);
  for (const { ours, theirs } of s.suggestions) {
    console.log(`  ~ ${ours.name} (${ours.id}) se parece a "${theirs.name}" (${theirs.account} / ${theirs.id})`);
    console.log(`      npx tsx db/koibox-link.ts staff ${ours.id} --account ${theirs.account} --user ${theirs.id}`);
  }
  if (s.unmatchedUsers.length > 0) {
    console.log(`  En Koibox sin pareja aquí: ${s.unmatchedUsers.map((u) => `${u.name} (${u.account} / ${u.id})`).join(", ")}`);
  }

  for (const p of plan.services) {
    console.log(`\n━━ Servicios de "${p.account}" (${p.alreadyLinked} ya enlazados${p.inactive ? `, ${p.inactive} de baja en Koibox` : ""})`);
    for (const { ours, theirs } of p.link) console.log(`  ✓ ${ours.name} (${ours.id}) → ${theirs.id} "${theirs.nombre}"`);
    for (const d of p.doubtful) {
      console.log(`  ? ${d.ours.name} (${d.ours.id}): ${d.reason}`);
      for (const t of d.theirs) console.log(`      npx tsx db/koibox-link.ts service ${d.ours.id} --account ${p.account} --koibox ${t.id}   ("${t.nombre}", ${minutes(t.duracion)})`);
    }
    for (const { ours, theirs } of p.suggestions) {
      console.log(`  ~ ${ours.name} (${ours.id}) se parece a "${theirs.nombre}" (${minutes(theirs.duracion)})`);
      console.log(`      npx tsx db/koibox-link.ts service ${ours.id} --account ${p.account} --koibox ${theirs.id}`);
    }
    if (p.missingInCatalog.length > 0) {
      console.log("  En Koibox, no en nuestro catálogo (no se crean solos):");
      for (const t of p.missingInCatalog) console.log(`    ${t.id} "${t.nombre}" · ${minutes(t.duracion)}${t.precio ? ` · ${t.precio} €` : ""}`);
    }
  }

  const safe = s.link.length + plan.services.reduce((n, p) => n + p.link.length, 0);
  if (!args.includes("--apply")) {
    console.log(`\n✓ = seguro (${safe}), ? = revisar, ~ = parecido. Para guardar los seguros: npx tsx db/koibox-match.ts --apply`);
    return;
  }
  const r = await applyKoiboxMatches(plan);
  console.log(`\nGuardado: ${r.staffLinked} profesional(es) y ${r.servicesLinked} servicio(s).`);
  for (const line of r.skipped) console.log(`  sin cambios: ${line}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pgClient.end());
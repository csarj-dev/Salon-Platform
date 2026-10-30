// Comprueba la conexión con Koibox SIN escribir nada: solo lecturas.
// Sirve para ver los ids de profesionales y servicios que pide db/koibox-link.ts,
// y para confirmar que los campos de la API son los que esperamos.
//   npx tsx db/koibox-try.ts                 (todas las cuentas del config)
//   npx tsx db/koibox-try.ts --account salon (solo una)
//   npx tsx db/koibox-try.ts --date 2026-11-05
// Con KOIBOX_DRIVER=fake (por defecto) habla con el Koibox de mentira; con api, con el real.
import "dotenv/config";
import { DateTime } from "luxon";
import { loadSalonConfig } from "../lib/salon-config";
import { getKoiboxClient, koiboxDriver } from "../lib/koibox/driver";
import { KoiboxError } from "../lib/koibox/limits";
import { WEEKDAY_FIELDS } from "@/lib/koibox/schedule";
import { refId, refText } from "../lib/koibox/types";

function option(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const config = await loadSalonConfig();
  const accounts = Object.keys(config.koibox.accounts);
  if (accounts.length === 0) throw new Error("El salón no tiene cuentas de Koibox en el config (koibox.accounts)");

  const only = option("--account");
  if (only && !accounts.includes(only)) throw new Error(`Cuenta "${only}" desconocida (hay: ${accounts.join(", ")})`);
  const date = option("--date") ?? DateTime.now().setZone(config.timezone).toISODate()!;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Fecha no válida: ${date} (formato 2026-11-05)`);

  console.log(`Koibox: driver "${koiboxDriver()}" · fecha ${date}\n`);

  for (const account of only ? [only] : accounts) {
    const label = config.koibox.accounts[account].label;
    console.log(`━━ ${account} · ${label}`);
    try {
      const api = getKoiboxClient(account, config.koibox);
      const me = await api.me();
      console.log(`Clave "${me.name}" · centro ${me.centro} (${me.centro_slug})`);

      const services = await api.listServices();
      const users = new Map<number, string>();
      console.log(`\nServicios (${services.length}):`);
      for (const s of services) {
        const who = s.users.map((u) => {
          const id = refId(u);
          const name = refText(u);
          if (id !== null && name) users.set(id, name);
          return name ?? `#${id}`;
        });
        console.log(`  ${s.id}  ${s.nombre} · ${s.duracion} · ${s.precio ?? "?"} € · ${who.join(", ") || "nadie"}`);
      }

      const appointments = await api.listAppointments({ from: date, to: date });
      for (const a of appointments) {
        const id = refId(a.user);
        const name = refText(a.user);
        if (id !== null && name) users.set(id, name);
      }
      console.log(`\nProfesionales vistas (id de usuaria para koibox-link):`);
      if (users.size === 0) console.log("  (ninguna: mira los servicios o las citas de otro día)");
      for (const [id, name] of [...users].sort((a, b) => a[1].localeCompare(b[1]))) console.log(`  ${id}  ${name}`);

      // Horarios y bloqueos: los usa el modo booking.availability = "koibox".
      // Sirve para comprobar con datos reales cómo vienen (semana, turno partido, repeticiones).
      const schedules = await api.listSchedules();
      console.log(`\nHorarios (${schedules.length}):`);
      for (const h of schedules) {
        const when = h.week ? `semana ${h.week}/${h.year}` : "de siempre";
        const days = WEEKDAY_FIELDS.map((field) => {
          const shifts = [h[field]].flat().filter((x) => x !== null);
          return shifts.length ? `${field.slice(0, 3)} ${shifts.map((x) => `${x.hora_inicio.slice(0, 5)}-${x.hora_fin.slice(0, 5)}`).join("+")}` : null;
        }).filter(Boolean);
        console.log(`  ${h.user === null ? "centro" : `usuaria ${h.user}`} · ${when} · ${days.join(", ") || "sin turnos"}`);
      }

      const blocks = await api.listBlocks({ to: date });
      console.log(`\nBloqueos hasta el ${date} (${blocks.length}):`);
      for (const b of blocks.slice(-20)) {
        console.log(`  ${b.fecha} ${b.hora_inicio.slice(0, 5)}–${b.hora_fin.slice(0, 5)}  usuaria ${b.user}  ${b.recurrencia ?? "none"}  ${b.titulo ?? ""}`);
      }

      console.log(`\nCitas del ${date} (${appointments.length}):`);
      for (const a of appointments) {
        const tags = (a.tags ?? []).map((t) => t.name).join(", ");
        console.log(
          `  ${a.id}  ${a.hora_inicio.slice(0, 5)}–${a.hora_fin?.slice(0, 5) ?? "?"}  ${refText(a.user) ?? refId(a.user)}  ` +
            `estado ${refId(a.estado ?? null) ?? "?"}  ${a.titulo}${tags ? `  [${tags}]` : ""}`,
        );
      }
    } catch (error) {
      if (error instanceof KoiboxError && error.code === "forbidden") {
        console.log("Koibox responde 403: la clave no vale o el centro no tiene plan Platinum.");
      } else {
        console.log(`Error: ${error instanceof Error ? error.message : String(error)}`);
      }
      process.exitCode = 1;
    }
    console.log("");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
import "dotenv/config";
import { eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "./index";
import { staff, service, location } from "./schema";
import { getAvailabilityForDay, type AvailabilityOptions } from "../lib/availability-db";
import { loadSalonConfig, toAvailabilityOptions } from "../lib/salon-config";

async function show(
  locationName: string,
  staffName: string,
  serviceName: string,
  date: string,
  opts: AvailabilityOptions,
) {
  const [loc] = await db.select().from(location).where(eq(location.name, locationName));
  const [st] = await db.select().from(staff).where(eq(staff.name, staffName));
  const [sv] = await db.select().from(service).where(eq(service.name, serviceName));
  if (!loc || !st || !sv) throw new Error(`No existe ${locationName}, ${staffName} o ${serviceName}`);

  const slots = await getAvailabilityForDay(loc.id, st.id, sv.id, date, opts);
  const local = slots.map((d) =>
    DateTime.fromJSDate(d, { zone: opts.zone }).toFormat("HH:mm"),
  );
  console.log(
    `${locationName} · ${staffName} · ${serviceName} · ${date}:`,
    local.join(" ") || "(sin huecos)",
  );
}

async function main() {
  const config = await loadSalonConfig();
  const opts = toAvailabilityOptions(config);
  console.log(`Salón: ${config.name} (${config.timezone})\n`);

  await show("The Room Studio", "Ana", "Laminado de cejas", "2026-11-02", opts);     // lunes, con cita
  await show("The Room Studio", "Lucía", "Diseño de cejas", "2026-11-03", opts);    // martes, día libre
  await show("The Room Micropigmentacion", "Ana", "Laminado de cejas", "2026-11-04", opts);       // miércoles, en Micropigmentación
  await show("The Room Studio", "Ana", "Laminado de cejas", "2026-11-04", opts);    // miércoles, Ana no está en Studio
  await show("The Room Micropigmentacion", "Marta", "Lifting de pestañas", "2026-11-02", opts);   // Micropigmentación no ofrece lifting Sur no ofrece lifting
  process.exit(0);
}

main();
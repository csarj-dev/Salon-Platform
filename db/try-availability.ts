import "dotenv/config";
import { eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "./index";
import { staff, service } from "./schema";
import { getAvailabilityForDay } from "../lib/availability-db";

const opts = { zone: "Atlantic/Canary", stepMin: 30, bufferMin: 15, minNoticeHours: 2 };

async function show(staffName: string, serviceName: string, date: string) {
  const [st] = await db.select().from(staff).where(eq(staff.name, staffName));
  const [sv] = await db.select().from(service).where(eq(service.name, serviceName));
  const slots = await getAvailabilityForDay(st.id, sv.id, date, opts);
  const local = slots.map((d) =>
    DateTime.fromJSDate(d, { zone: opts.zone }).toFormat("HH:mm"),
  );
  console.log(`${staffName} · ${serviceName} · ${date}:`, local.join(" ") || "(sin huecos)");
}

async function main() {
  await show("Ana", "Laminado de cejas", "2026-11-02");   // lunes, con una cita
  await show("Lucía", "Diseño de cejas", "2026-11-03");   // martes, día libre
  await show("Marta", "Laminado de cejas", "2026-11-02"); // lunes, solo tarde
  await show("Ana", "Lifting de pestañas", "2026-11-02"); // Ana no lo hace
  process.exit(0);
}

main();
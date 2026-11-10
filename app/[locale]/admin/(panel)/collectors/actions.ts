"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { setStaffCollector } from "@/lib/collectors-db";
import { COLLECTOR_ID, loadSalonConfig } from "@/lib/salon-config";
import { requireStaff } from "@/lib/session";

export type CollectorActionError = "invalid" | "unknownCollector" | "notFound" | "server";
export type CollectorActionResult = { ok: true } | { ok: false; error: CollectorActionError };

const inputSchema = z.object({
  staffId: z.number().int().positive(),
  collector: z.string().regex(COLLECTOR_ID).nullable(),
});

// null = sin cobrador propio (el de su cuenta o el de por defecto)
export async function setStaffCollectorAction(
  staffId: number,
  collector: string | null,
): Promise<CollectorActionResult> {
  const locale = await getLocale();
  await requireStaff(locale, "settings.manage");

  const parsed = inputSchema.safeParse({ staffId, collector });
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const config = await loadSalonConfig();
    const result = await setStaffCollector(config, parsed.data.staffId, parsed.data.collector);
    if (result !== "ok") return { ok: false, error: result };
  } catch (error) {
    console.error("[collectors]", error);
    return { ok: false, error: "server" };
  }

  revalidatePath(`/${locale}/admin/collectors`);
  revalidatePath(`/${locale}/admin/deposits`);
  return { ok: true };
}
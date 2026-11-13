"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { KOIBOX_ACCOUNT_ID, loadSalonConfig } from "@/lib/salon-config";
import { setServiceKoiboxLink, setStaffKoiboxLink } from "@/lib/koibox-links-db";
import { applyKoiboxMatches, planKoiboxMatches } from "@/lib/koibox-match-db";
import { koiboxPanelApiFor, writesToKoibox } from "@/lib/koibox-sync";
import { requireStaff } from "@/lib/session";

type GuardError = "disabled";

// Los Server Actions son endpoints públicos: se vuelve a comprobar permiso y modo Koibox
async function guard() {
  const locale = await getLocale();
  await requireStaff(locale, "settings.manage");
  const config = await loadSalonConfig();
  return { locale, config, enabled: writesToKoibox(config) };
}

const linkSchema = z.object({
  staffId: z.number().int().positive(),
  link: z
    .object({ account: z.string().regex(KOIBOX_ACCOUNT_ID), userId: z.number().int().positive() })
    .nullable(),
});

export type KoiboxLinkResult =
  | { ok: true }
  | { ok: false; error: GuardError | "invalid" | "unknownAccount" | "userTaken" | "notFound" | "server" };

export async function setStaffKoiboxLinkAction(
  staffId: number,
  link: { account: string; userId: number } | null,
): Promise<KoiboxLinkResult> {
  const { locale, config, enabled } = await guard();
  if (!enabled) return { ok: false, error: "disabled" };

  const parsed = linkSchema.safeParse({ staffId, link });
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const result = await setStaffKoiboxLink(config, parsed.data.staffId, parsed.data.link);
    if (result !== "ok") return { ok: false, error: result };
  } catch (error) {
    console.error("[koibox] enlazar profesional", error);
    return { ok: false, error: "server" };
  }

  revalidatePath(`/${locale}/admin/koibox`);
  revalidatePath(`/${locale}/admin/koibox/match`);
  revalidatePath(`/${locale}/admin/collectors`);
  return { ok: true };
}

const serviceLinkSchema = z.object({
  serviceId: z.number().int().positive(),
  account: z.string().regex(KOIBOX_ACCOUNT_ID),
  koiboxServiceId: z.number().int().positive().nullable(),
});

// null = quitar el id de ese servicio en esa cuenta
export async function setServiceKoiboxLinkAction(
  serviceId: number,
  account: string,
  koiboxServiceId: number | null,
): Promise<KoiboxLinkResult> {
  const { locale, config, enabled } = await guard();
  if (!enabled) return { ok: false, error: "disabled" };

  const parsed = serviceLinkSchema.safeParse({ serviceId, account, koiboxServiceId });
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const result = await setServiceKoiboxLink(config, parsed.data.serviceId, parsed.data.account, parsed.data.koiboxServiceId);
    if (result !== "ok") return { ok: false, error: result };
  } catch (error) {
    console.error("[koibox] enlazar servicio", error);
    return { ok: false, error: "server" };
  }

  revalidatePath(`/${locale}/admin/koibox`);
  revalidatePath(`/${locale}/admin/koibox/match`);
  return { ok: true };
}

export type ApplyMatchesResult =
  | { ok: true; staffLinked: number; servicesLinked: number; skipped: string[] }
  | { ok: false; error: GuardError | "server" };

// Guarda lo seguro. La propuesta se vuelve a calcular aquí: no se fía de lo que mande el navegador.
// Con su propia cola y tiempo máximo (koiboxPanelApiFor), como la página de Emparejar.
export async function applyKoiboxMatchesAction(): Promise<ApplyMatchesResult> {
  const { locale, config, enabled } = await guard();
  if (!enabled) return { ok: false, error: "disabled" };
  try {
    const summary = await applyKoiboxMatches(await planKoiboxMatches(config, koiboxPanelApiFor(config)));
    revalidatePath(`/${locale}/admin/koibox`);
    revalidatePath(`/${locale}/admin/koibox/match`);
    revalidatePath(`/${locale}/admin/collectors`);
    return { ok: true, ...summary };
  } catch (error) {
    console.error("[koibox] guardar emparejados", error);
    return { ok: false, error: "server" };
  }
}
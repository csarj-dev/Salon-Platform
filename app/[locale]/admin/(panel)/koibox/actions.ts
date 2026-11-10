"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { KOIBOX_ACCOUNT_ID, loadSalonConfig } from "@/lib/salon-config";
import {
  koiboxServicesForAccount, koiboxUsersForAccount, setServiceKoiboxLink, setStaffKoiboxLink, type KoiboxServiceOption,
} from "@/lib/koibox-links-db";
import { applyKoiboxMatches, planKoiboxMatches } from "@/lib/koibox-match-db";
import { matchPlanView, type MatchView } from "@/lib/koibox-match-view";
import { koiboxApiFor, writesToKoibox } from "@/lib/koibox-sync";
import { requireStaff } from "@/lib/session";

type GuardError = "disabled";

// Los Server Actions son endpoints públicos: se vuelve a comprobar permiso y modo Koibox
async function guard() {
  const locale = await getLocale();
  await requireStaff(locale, "settings.manage");
  const config = await loadSalonConfig();
  return { locale, config, enabled: writesToKoibox(config) };
}

export type KoiboxUsersResult =
  | { ok: true; users: { id: number; name: string }[] }
  | { ok: false; error: GuardError | "invalid" | "unknownAccount" | "koibox" };

export async function koiboxUsersAction(account: string): Promise<KoiboxUsersResult> {
  const { config, enabled } = await guard();
  if (!enabled) return { ok: false, error: "disabled" };
  if (typeof account !== "string" || !KOIBOX_ACCOUNT_ID.test(account)) return { ok: false, error: "invalid" };
  if (!Object.hasOwn(config.koibox.accounts, account)) return { ok: false, error: "unknownAccount" };

  try {
    const users = await koiboxUsersForAccount(config, account);
    return { ok: true, users: users.map((u) => ({ id: u.id, name: u.name })) };
  } catch (error) {
    console.error("[koibox] usuarias de", account, error);
    return { ok: false, error: "koibox" };
  }
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
  revalidatePath(`/${locale}/admin/collectors`);
  return { ok: true };
}

export type KoiboxServicesResult =
  | { ok: true; services: KoiboxServiceOption[] }
  | { ok: false; error: GuardError | "invalid" | "unknownAccount" | "koibox" };

export async function koiboxServicesAction(account: string): Promise<KoiboxServicesResult> {
  const { config, enabled } = await guard();
  if (!enabled) return { ok: false, error: "disabled" };
  if (typeof account !== "string" || !KOIBOX_ACCOUNT_ID.test(account)) return { ok: false, error: "invalid" };
  if (!Object.hasOwn(config.koibox.accounts, account)) return { ok: false, error: "unknownAccount" };

  try {
    return { ok: true, services: await koiboxServicesForAccount(config, account) };
  } catch (error) {
    console.error("[koibox] servicios de", account, error);
    return { ok: false, error: "koibox" };
  }
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
  return { ok: true };
}

export type MatchPlanResult = { ok: true; view: MatchView } | { ok: false; error: GuardError | "server" };

// La propuesta de emparejar (lo mismo que npx tsx db/koibox-match.ts sin --apply)
export async function planKoiboxMatchesAction(): Promise<MatchPlanResult> {
  const { config, enabled } = await guard();
  if (!enabled) return { ok: false, error: "disabled" };
  try {
    return { ok: true, view: matchPlanView(await planKoiboxMatches(config, koiboxApiFor(config))) };
  } catch (error) {
    console.error("[koibox] emparejar", error);
    return { ok: false, error: "server" };
  }
}

export type ApplyMatchesResult =
  | { ok: true; staffLinked: number; servicesLinked: number; skipped: string[] }
  | { ok: false; error: GuardError | "server" };

// Guarda lo seguro. La propuesta se vuelve a calcular aquí: no se fía de lo que mande el navegador.
export async function applyKoiboxMatchesAction(): Promise<ApplyMatchesResult> {
  const { locale, config, enabled } = await guard();
  if (!enabled) return { ok: false, error: "disabled" };
  try {
    const summary = await applyKoiboxMatches(await planKoiboxMatches(config, koiboxApiFor(config)));
    revalidatePath(`/${locale}/admin/koibox`);
    revalidatePath(`/${locale}/admin/collectors`);
    return { ok: true, ...summary };
  } catch (error) {
    console.error("[koibox] guardar emparejados", error);
    return { ok: false, error: "server" };
  }
}
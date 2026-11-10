"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { koiboxUsersForAccount, setStaffKoiboxLink } from "@/lib/koibox-links-db";
import { writesToKoibox } from "@/lib/koibox-sync";
import { KOIBOX_ACCOUNT_ID, loadSalonConfig } from "@/lib/salon-config";
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
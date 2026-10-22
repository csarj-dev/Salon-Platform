"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { auth } from "@/lib/auth";
import { ROLES, isRole } from "@/lib/permissions";
import { requireStaff } from "@/lib/session";
import {
  checkDeactivate,
  checkRoleChange,
  countActiveAdmins,
  type UserRuleError,
} from "@/lib/user-rules";

type ActionError = UserRuleError | "invalid" | "emailTaken" | "notFound" | "server";
export type UserActionResult = { ok: true } | { ok: false; error: ActionError };
export type CreateUserState = UserActionResult | null;

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(10).max(128),
  role: z.enum(ROLES),
});
const passwordSchema = z.string().min(10).max(128);

// Cada acción vuelve a comprobar que quien llama es admin: los Server Actions
// son endpoints públicos, no basta con que el botón esté oculto.
async function guard() {
  const locale = await getLocale();
  const { user: actor } = await requireStaff(locale, "users.manage");
  return { locale, actorId: actor.id };
}

async function loadAll() {
  return db.select({ id: user.id, role: user.role, banned: user.banned }).from(user);
}

function done(locale: string): UserActionResult {
  revalidatePath(`/${locale}/admin/users`);
  return { ok: true };
}

function failed(error: unknown): UserActionResult {
  console.error("[users]", error);
  return { ok: false, error: "server" };
}

export async function createUserAction(
  _previous: CreateUserState,
  formData: FormData,
): Promise<CreateUserState> {
  const { locale } = await guard();
  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { ok: false, error: "invalid" };

  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, parsed.data.email))
    .limit(1);
  if (existing) return { ok: false, error: "emailTaken" };

  try {
    await auth.api.createUser({ body: parsed.data, headers: await headers() });
  } catch (error) {
    return failed(error);
  }
  return done(locale);
}

export async function changeRoleAction(userId: string, newRole: string): Promise<UserActionResult> {
  const { locale, actorId } = await guard();
  if (!isRole(newRole)) return { ok: false, error: "invalidRole" };

  const all = await loadAll();
  const target = all.find((u) => u.id === userId);
  if (!target) return { ok: false, error: "notFound" };

  const blocked = checkRoleChange({
    actorId,
    target,
    newRole,
    activeAdmins: countActiveAdmins(all),
  });
  if (blocked) return { ok: false, error: blocked };

  try {
    await auth.api.setRole({ body: { userId, role: newRole }, headers: await headers() });
  } catch (error) {
    return failed(error);
  }
  return done(locale);
}

export async function setActiveAction(userId: string, active: boolean): Promise<UserActionResult> {
  const { locale, actorId } = await guard();

  const all = await loadAll();
  const target = all.find((u) => u.id === userId);
  if (!target) return { ok: false, error: "notFound" };

  try {
    if (active) {
      await auth.api.unbanUser({ body: { userId }, headers: await headers() });
    } else {
      const blocked = checkDeactivate({ actorId, target, activeAdmins: countActiveAdmins(all) });
      if (blocked) return { ok: false, error: blocked };
      await auth.api.banUser({ body: { userId }, headers: await headers() });
    }
  } catch (error) {
    return failed(error);
  }
  return done(locale);
}

export async function resetPasswordAction(
  userId: string,
  newPassword: string,
): Promise<UserActionResult> {
  const { locale } = await guard();
  if (!passwordSchema.safeParse(newPassword).success) return { ok: false, error: "invalid" };

  const [target] = await db.select({ id: user.id }).from(user).where(eq(user.id, userId)).limit(1);
  if (!target) return { ok: false, error: "notFound" };

  try {
    await auth.api.setUserPassword({
      body: { userId, newPassword },
      headers: await headers(),
    });
  } catch (error) {
    return failed(error);
  }
  return done(locale);
}
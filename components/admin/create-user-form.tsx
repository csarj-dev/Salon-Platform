"use client";

import { useActionState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { createUserAction, type CreateUserState } from "@/app/[locale]/admin/(panel)/users/actions";
import { ROLES } from "@/lib/permissions";
import { Button } from "@/components/ui/button";

const inputClass =
  "h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function CreateUserForm() {
  const t = useTranslations("Admin.users");
  const tRoles = useTranslations("Admin.roles");
  const [state, formAction, pending] = useActionState<CreateUserState, FormData>(
    createUserAction,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);

  // Al crear con éxito se vacía el formulario
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4 rounded-lg border p-4">
      <h2 className="text-lg font-semibold">{t("createTitle")}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="new-name" className="text-sm font-medium">
            {t("name")}
          </label>
          <input id="new-name" name="name" required maxLength={80} className={inputClass} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="new-email" className="text-sm font-medium">
            {t("email")}
          </label>
          <input
            id="new-email"
            name="email"
            type="email"
            required
            autoComplete="off"
            className={inputClass}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="new-password" className="text-sm font-medium">
            {t("password")}
          </label>
          <input
            id="new-password"
            name="password"
            type="password"
            required
            minLength={10}
            maxLength={128}
            autoComplete="new-password"
            className={inputClass}
          />
          <p className="text-xs text-muted-foreground">{t("passwordHint")}</p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="new-role" className="text-sm font-medium">
            {t("role")}
          </label>
          <select id="new-role" name="role" defaultValue="reception" className={inputClass}>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {tRoles(role)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {state && !state.ok && (
        <p role="alert" className="text-sm text-destructive">
          {t(`errors.${state.error}`)}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("created")}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? t("creating") : t("create")}
      </Button>
    </form>
  );
}
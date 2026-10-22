"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  changeRoleAction,
  resetPasswordAction,
  setActiveAction,
  type UserActionResult,
} from "@/app/[locale]/admin/(panel)/users/actions";
import { ROLES, parseRoles } from "@/lib/permissions";
import { Button } from "@/components/ui/button";

type Props = {
  id: string;
  name: string;
  email: string;
  role: string | null;
  banned: boolean;
  isSelf: boolean;
};

const inputClass =
  "h-8 rounded-lg border bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function UserRow({ id, name, email, role, banned, isSelf }: Props) {
  const t = useTranslations("Admin.users");
  const tRoles = useTranslations("Admin.roles");
  const currentRole = parseRoles(role)[0] ?? "reception";
  const [selected, setSelected] = useState<string>(currentRole);
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function run(task: () => Promise<UserActionResult>, okText: string, after?: () => void) {
    setMessage(null);
    startTransition(async () => {
      const result = await task();
      if (result.ok) {
        setMessage({ ok: true, text: okText });
        after?.();
      } else {
        setMessage({ ok: false, text: t(`errors.${result.error}`) });
      }
    });
  }

  function onPasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const password = String(new FormData(form).get("password") ?? "");
    run(() => resetPasswordAction(id, password), t("passwordChanged"), () => {
      form.reset();
      setShowPassword(false);
    });
  }

  return (
    <li className="space-y-3 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">
            {name}
            {isSelf && <span className="text-muted-foreground"> {t("you")}</span>}
          </p>
          <p className="truncate text-sm text-muted-foreground">{email}</p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${
            banned ? "text-destructive" : "text-muted-foreground"
          }`}
        >
          {banned ? t("inactive") : t("active")}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`role-${id}`}>
          {t("role")}
        </label>
        <select
          id={`role-${id}`}
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={isSelf || pending}
          className={inputClass}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {tRoles(r)}
            </option>
          ))}
        </select>
        {selected !== currentRole && (
          <Button
            size="sm"
            disabled={pending}
            onClick={() => run(() => changeRoleAction(id, selected), t("roleChanged"))}
          >
            {t("saveRole")}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={pending || (isSelf && !banned)}
          onClick={() => {
            if (!banned && !window.confirm(t("confirmDeactivate", { name }))) return;
            run(() => setActiveAction(id, banned), banned ? t("reactivated") : t("deactivated"));
          }}
        >
          {banned ? t("reactivate") : t("deactivate")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => setShowPassword((v) => !v)}
        >
          {t("resetPassword")}
        </Button>
      </div>

      {showPassword && (
        <form onSubmit={onPasswordSubmit} className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`pw-${id}`}>
            {t("newPassword")}
          </label>
          <input
            id={`pw-${id}`}
            name="password"
            type="password"
            required
            minLength={10}
            maxLength={128}
            autoComplete="new-password"
            placeholder={t("newPassword")}
            className={`${inputClass} w-56`}
          />
          <Button type="submit" size="sm" disabled={pending}>
            {t("setPassword")}
          </Button>
        </form>
      )}

      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={`text-sm ${message.ok ? "text-muted-foreground" : "text-destructive"}`}
        >
          {message.text}
        </p>
      )}
    </li>
  );
}
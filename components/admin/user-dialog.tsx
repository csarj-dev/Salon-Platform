"use client";

import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  createUserAction,
  saveUserAction,
  setActiveAction,
  type UserActionResult,
} from "@/app/[locale]/admin/(panel)/users/actions";
import { Button } from "@/components/ui/button";
import { ROLES, type Role } from "@/lib/permissions";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/user-rules";
import { textAction, UserAvatar } from "./panel-ui";

export type DialogUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  banned: boolean;
  isSelf: boolean;
  since: string; // «desde el 3 oct», ya formateado por la página
};

type Props = { mode: "create" } | { mode: "edit"; user: DialogUser };

const fieldClass =
  "h-11 w-full rounded-lg border bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60";

// «Nuevo usuario» y «Editar» en un diálogo (diseño Usuarios B).
// Editar: rol y contraseña se guardan juntos; desactivar va aparte, con su confirmación.
export function UserDialog(props: Props) {
  const t = useTranslations("Admin.users");
  const tRoles = useTranslations("Admin.roles");
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const titleId = useId();
  const editing = props.mode === "edit" ? props.user : null;

  const [role, setRole] = useState<Role>(editing?.role ?? "reception");
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Al abrir, siempre desde cero: lo que se escribió y no se guardó se descarta
  function open() {
    form.current?.reset();
    setRole(editing?.role ?? "reception");
    setConfirmingDeactivate(false);
    setError(null);
    dialog.current?.showModal();
  }

  function close() {
    dialog.current?.close();
  }

  // Si va bien se cierra (la página se actualiza sola); si no, se explica el motivo
  function run(task: () => Promise<UserActionResult | null>) {
    setError(null);
    startTransition(async () => {
      const result = await task();
      if (result?.ok) close();
      else if (result) setError(t(`errors.${result.error}`));
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (editing) {
      const password = String(data.get("password") ?? "");
      // Tu propio rol no se envía: así puedes cambiar solo tu contraseña
      run(() => saveUserAction(editing.id, { role: editing.isSelf ? null : role, password }));
    } else {
      data.set("role", role);
      run(() => createUserAction(null, data));
    }
  }

  return (
    <>
      {editing ? (
        <button type="button" className={textAction()} onClick={open}>
          {t("edit")}
          <span className="sr-only"> {editing.name}</span>
        </button>
      ) : (
        <Button type="button" className="h-11 cursor-pointer gap-2 px-4" onClick={open}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
          {t("newUser")}
        </Button>
      )}

      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="m-auto w-[min(35rem,calc(100vw-2rem))] rounded-xl border bg-card p-0 text-left text-foreground shadow-xl backdrop:bg-foreground/40"
      >
        <form ref={form} onSubmit={onSubmit}>
          <div className="flex items-start justify-between gap-3 px-5 pt-5">
            {editing ? (
              <div className="flex min-w-0 items-center gap-3">
                <UserAvatar name={editing.name} className="size-11 text-sm" />
                <div className="min-w-0">
                  <h2 id={titleId} className="truncate text-lg font-semibold">
                    {editing.name}
                  </h2>
                  <p className="truncate text-sm text-muted-foreground">
                    {editing.email} · {editing.since}
                  </p>
                </div>
              </div>
            ) : (
              <h2 id={titleId} className="pt-2 text-lg font-semibold">
                {t("createTitle")}
              </h2>
            )}
            <button
              type="button"
              onClick={close}
              aria-label={t("close")}
              className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          <div className="space-y-5 p-5">
            {!editing && (
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">{t("name")}</span>
                  <input name="name" required maxLength={80} autoComplete="off" disabled={pending} className={fieldClass} />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">{t("email")}</span>
                  <input name="email" type="email" required autoComplete="off" disabled={pending} className={fieldClass} />
                </label>
              </div>
            )}

            <fieldset className="space-y-2" disabled={pending || Boolean(editing?.isSelf)}>
              <legend className="mb-2 text-sm font-semibold">{t("role")}</legend>
              {ROLES.map((r) => (
                <label
                  key={r}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:checked]:border-foreground has-[:checked]:ring-1 has-[:checked]:ring-foreground has-[:disabled]:cursor-default has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                >
                  <input
                    type="radio"
                    name="role"
                    value={r}
                    checked={role === r}
                    onChange={() => setRole(r)}
                    className="mt-0.5 size-4 accent-foreground"
                  />
                  <span>
                    <span className="block text-sm font-medium">{tRoles(r)}</span>
                    <span className="block text-sm text-muted-foreground">{t(`roleHints.${r}`)}</span>
                  </span>
                </label>
              ))}
              {editing?.isSelf && <p className="text-sm text-muted-foreground">{t("selfRoleNote")}</p>}
            </fieldset>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">
                {editing ? t("newPassword") : t("password")}
                {editing && <span className="font-normal text-muted-foreground"> · {t("optional")}</span>}
              </span>
              <input
                name="password"
                type="password"
                required={!editing}
                minLength={PASSWORD_MIN}
                maxLength={PASSWORD_MAX}
                autoComplete="new-password"
                placeholder={t("passwordMin", { min: PASSWORD_MIN })}
                disabled={pending}
                className={fieldClass}
              />
              <span className="block text-sm text-muted-foreground">
                {editing ? t("newPasswordHint") : t("passwordHint")}
              </span>
            </label>

            {editing && !editing.isSelf && editing.banned && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted p-3.5">
                <div className="min-w-0 flex-[1_1_16rem]">
                  <p className="text-sm font-medium">{t("inactiveTitle", { name: editing.name })}</p>
                  <p className="text-sm text-muted-foreground">{t("reactivateHint")}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 cursor-pointer px-4"
                  disabled={pending}
                  onClick={() => run(() => setActiveAction(editing.id, true))}
                >
                  {t("reactivate")}
                </Button>
              </div>
            )}

            {editing && !editing.isSelf && !editing.banned && (
              <div className="space-y-3 rounded-lg bg-danger/8 p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-[1_1_16rem]">
                    <p className="text-sm font-medium">{t("deactivateTitle", { name: editing.name })}</p>
                    <p className="text-sm text-muted-foreground">{t("deactivateHint")}</p>
                  </div>
                  {!confirmingDeactivate && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => setConfirmingDeactivate(true)}
                      className="h-10 cursor-pointer rounded-md border border-danger bg-card px-3.5 text-sm font-medium text-danger outline-none hover:bg-danger/10 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      {t("deactivate")}
                    </button>
                  )}
                </div>
                {confirmingDeactivate && (
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(() => setActiveAction(editing.id, false))}
                      className="h-10 cursor-pointer rounded-md bg-danger px-3.5 text-sm font-medium text-background outline-none hover:bg-danger/90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      {pending ? t("deactivating") : t("confirmDeactivate")}
                    </button>
                    <button
                      type="button"
                      className={textAction()}
                      disabled={pending}
                      onClick={() => setConfirmingDeactivate(false)}
                    >
                      {t("back")}
                    </button>
                  </div>
                )}
              </div>
            )}

            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t px-5 py-3.5">
            <Button type="button" variant="outline" className="h-11 cursor-pointer px-4" onClick={close} disabled={pending}>
              {t("cancel")}
            </Button>
            <Button type="submit" className="h-11 cursor-pointer px-4" disabled={pending}>
              {pending ? t(editing ? "saving" : "creating") : t(editing ? "save" : "create")}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
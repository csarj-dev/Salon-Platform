"use client";

import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { setStaffKoiboxLinkAction } from "@/app/[locale]/admin/(panel)/koibox/actions";
import { Button } from "@/components/ui/button";
import { textAction } from "./panel-ui";

type Account = { id: string; label: string };
type Taken = { account: string; userId: number; staffName: string };
type User = { id: number; name: string };

type Props = {
  staffId: number;
  name: string;
  account: string | null;
  userId: number | null;
  accounts: Account[];
  usersByAccount: Record<string, User[] | null>; // null: esa cuenta no ha respondido
  taken: Taken[]; // usuarias ya enlazadas (de todas las profesionales)
};

const fieldClass =
  "h-11 w-full rounded-lg border bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

// "Editar" de una profesional en Koibox: su cuenta y quién es en ella (diseño K3)
export function StaffKoiboxDialog(props: Props) {
  const t = useTranslations("Admin.koibox");
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [account, setAccount] = useState(props.account ?? "");
  const [userId, setUserId] = useState(props.userId ? String(props.userId) : "");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const users = account ? (props.usersByAccount[account] ?? null) : null;
  // ¿Esta usuaria ya es otra profesional? (la propia no cuenta)
  const takenBy = (id: number) =>
    props.taken.find(
      (x) => x.account === account && x.userId === id && !(props.account === account && props.userId === id),
    )?.staffName;
  // La usuaria actual puede no salir en la lista (si no hace ningún servicio en Koibox)
  const currentMissing = users !== null && userId !== "" && !users.some((u) => String(u.id) === userId);

  function open() {
    setAccount(props.account ?? "");
    setUserId(props.userId ? String(props.userId) : "");
    setError(null);
    dialog.current?.showModal();
  }

  function close() {
    dialog.current?.close();
  }

  function save(link: { account: string; userId: number } | null) {
    setError(null);
    startSaving(async () => {
      const result = await setStaffKoiboxLinkAction(props.staffId, link);
      if (result.ok) close();
      else setError(t(`errors.${result.error}`));
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account) return save(null);
    const id = Number(userId);
    if (!Number.isInteger(id) || id <= 0) {
      setError(t("errors.pickUser"));
      return;
    }
    save({ account, userId: id });
  }

  return (
    <>
      <button type="button" className={textAction()} onClick={open}>
        {t("edit")}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border bg-card p-0 text-left text-foreground shadow-xl backdrop:bg-foreground/40"
      >
        <form onSubmit={onSubmit} className="space-y-4 p-5">
          <div className="space-y-1">
            <h2 id={titleId} className="text-lg font-semibold">
              {t("editTitle", { name: props.name })}
            </h2>
            <p className="text-sm text-muted-foreground">{t("saveHint")}</p>
          </div>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{t("accountLabel")}</span>
            <select
              value={account}
              onChange={(e) => {
                setAccount(e.target.value);
                setUserId("");
              }}
              disabled={saving}
              className={fieldClass}
            >
              <option value="">{t("noAccount")}</option>
              {props.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>

          {account && (
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">{t("userLabel")}</span>
              {users ? (
                <select value={userId} onChange={(e) => setUserId(e.target.value)} disabled={saving} className={fieldClass}>
                  <option value="">{t("pickUser")}</option>
                  {currentMissing && <option value={userId}>{t("currentUser", { id: userId })}</option>}
                  {users.map((u) => {
                    const other = takenBy(u.id);
                    return (
                      <option key={u.id} value={u.id} disabled={Boolean(other)}>
                        {other
                          ? t("userTaken", { name: u.name, id: u.id, staff: other })
                          : t("userOption", { name: u.name, id: u.id })}
                      </option>
                    );
                  })}
                </select>
              ) : (
                <input
                  inputMode="numeric"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value.replace(/\D/g, ""))}
                  disabled={saving}
                  placeholder="1234"
                  className={fieldClass}
                />
              )}
              <span className="block text-sm text-muted-foreground">
                {users ? t("userHint") : t("usersFailed")}
              </span>
            </label>
          )}

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            {props.account ? (
              <button type="button" className={textAction("danger")} onClick={() => save(null)} disabled={saving}>
                {t("unlink")}
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="h-10 px-4" onClick={close} disabled={saving}>
                {t("cancel")}
              </Button>
              <Button type="submit" className="h-10 px-4" disabled={saving}>
                {saving ? t("saving") : t("save")}
              </Button>
            </div>
          </div>
        </form>
      </dialog>
    </>
  );
}
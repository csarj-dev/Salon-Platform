"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { koiboxUsersAction, setStaffKoiboxLinkAction } from "@/app/[locale]/admin/(panel)/koibox/actions";
import { Button } from "@/components/ui/button";

type Account = { id: string; label: string };
type Taken = { account: string; userId: number; staffName: string };

type Props = {
  staffId: number;
  name: string;
  account: string | null;
  userId: number | null;
  unknownAccount: boolean;
  missingServices: string[];
  accounts: Account[];
  taken: Taken[]; // usuarias ya enlazadas (de todas las profesionales)
};

const fieldClass =
  "h-11 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function StaffKoiboxRow(props: Props) {
  const t = useTranslations("Admin.koibox");
  const [editing, setEditing] = useState(false);
  const [account, setAccount] = useState(props.account ?? "");
  const [userId, setUserId] = useState(props.userId ? String(props.userId) : "");
  const [users, setUsers] = useState<{ id: number; name: string }[] | null>(null);
  const [usersFailed, setUsersFailed] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();

  const accountLabel = (id: string) => props.accounts.find((a) => a.id === id)?.label ?? id;
  // ¿Esta usuaria ya es otra profesional? (la propia no cuenta)
  const takenBy = (id: number) =>
    props.taken.find(
      (x) => x.account === account && x.userId === id && !(props.account === account && props.userId === id),
    )?.staffName;

  function loadUsers(next: string) {
    setUsers(null);
    setUsersFailed(false);
    if (!next) return;
    startLoading(async () => {
      const result = await koiboxUsersAction(next);
      if (result.ok) setUsers(result.users);
      else setUsersFailed(true);
    });
  }

  function open() {
    setEditing(true);
    setMessage(null);
    loadUsers(account);
  }

  function cancel() {
    setEditing(false);
    setAccount(props.account ?? "");
    setUserId(props.userId ? String(props.userId) : "");
  }

  function changeAccount(next: string) {
    setAccount(next);
    setUserId("");
    loadUsers(next);
  }

  function save(link: { account: string; userId: number } | null) {
    setMessage(null);
    startSaving(async () => {
      const result = await setStaffKoiboxLinkAction(props.staffId, link);
      if (result.ok) {
        setEditing(false);
        setMessage({ ok: true, text: t("saved") });
      } else {
        setMessage({ ok: false, text: t(`errors.${result.error}`) });
      }
    });
  }

  function onSave() {
    if (!account) return save(null);
    const id = Number(userId);
    if (!Number.isInteger(id) || id <= 0) {
      setMessage({ ok: false, text: t("errors.pickUser") });
      return;
    }
    save({ account, userId: id });
  }

  // La usuaria actual puede no salir en la lista (si no hace ningún servicio en Koibox)
  const currentMissing =
    users !== null && userId !== "" && !users.some((u) => String(u.id) === userId);

  return (
    <li className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{props.name}</p>
          <p className="text-sm text-muted-foreground">
            {props.account
              ? t("linkedTo", { account: accountLabel(props.account), user: props.userId ?? 0 })
              : t("notLinked")}
          </p>
        </div>
        {!editing && (
          <Button type="button" variant="outline" onClick={open}>
            {t("edit")}
          </Button>
        )}
      </div>

      {props.unknownAccount && (
        <p className="text-sm text-destructive">{t("unknownAccount", { account: props.account ?? "" })}</p>
      )}
      {props.missingServices.length > 0 && (
        <p className="text-sm text-destructive">
          {t("missingServices", { services: props.missingServices.join(", ") })}
        </p>
      )}

      {editing && (
        <div className="space-y-4 rounded-lg bg-muted/50 p-3">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{t("accountLabel")}</span>
            <select
              value={account}
              onChange={(e) => changeAccount(e.target.value)}
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
              {loading ? (
                <span className="block text-sm text-muted-foreground">{t("loadingUsers")}</span>
              ) : users ? (
                <select
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  disabled={saving}
                  className={fieldClass}
                >
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
                {usersFailed ? t("usersFailed") : t("userHint")}
              </span>
            </label>
          )}

          <p className="text-sm text-muted-foreground">{t("saveHint")}</p>

          <div className="flex flex-wrap items-center justify-between gap-2">
            {props.account ? (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive"
                onClick={() => save(null)}
                disabled={saving}
              >
                {t("unlink")}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={cancel} disabled={saving}>
                {t("cancel")}
              </Button>
              <Button type="button" onClick={onSave} disabled={saving || loading}>
                {saving ? t("saving") : t("save")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {message && (
        <p role="status" className={message.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
          {message.text}
        </p>
      )}
    </li>
  );
}
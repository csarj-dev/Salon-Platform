"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { koiboxServicesAction, setServiceKoiboxLinkAction } from "@/app/[locale]/admin/(panel)/koibox/actions";
import { Button } from "@/components/ui/button";

type AccountLink = { account: string; label: string; koiboxServiceId: number | null; neededBy: string[] };
type Option = { id: number; name: string; minutes: number | null };

type Props = { serviceId: number; name: string; durationMin: number; accounts: AccountLink[] };

const fieldClass =
  "h-11 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function ServiceKoiboxRow(props: Props) {
  const t = useTranslations("Admin.koibox");
  const [editing, setEditing] = useState<string | null>(null);
  const [choice, setChoice] = useState("");
  const [options, setOptions] = useState<Option[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();

  const minutes = (m: number | null) => (m === null ? "?" : t("minutes", { count: m }));

  function open(link: AccountLink) {
    setEditing(link.account);
    setChoice(link.koiboxServiceId ? String(link.koiboxServiceId) : "");
    setOptions(null);
    setFailed(false);
    setMessage(null);
    startLoading(async () => {
      const result = await koiboxServicesAction(link.account);
      if (result.ok) setOptions(result.services);
      else setFailed(true);
    });
  }

  function save(account: string, koiboxServiceId: number | null) {
    setMessage(null);
    startSaving(async () => {
      const result = await setServiceKoiboxLinkAction(props.serviceId, account, koiboxServiceId);
      if (result.ok) {
        setEditing(null);
        setMessage({ ok: true, text: t("saved") });
      } else {
        setMessage({ ok: false, text: t(`errors.${result.error}`) });
      }
    });
  }

  function onSave(account: string) {
    const id = Number(choice);
    if (!Number.isInteger(id) || id <= 0) {
      setMessage({ ok: false, text: t("errors.pickService") });
      return;
    }
    save(account, id);
  }

  return (
    <li className="space-y-3 rounded-lg border p-4">
      <p className="font-medium">
        {props.name} <span className="text-sm font-normal text-muted-foreground">· {minutes(props.durationMin)}</span>
      </p>

      <ul className="space-y-2">
        {props.accounts.map((link) => {
          const missing = link.koiboxServiceId === null && link.neededBy.length > 0;
          return (
            <li key={link.account} className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{link.label}</span>
                  {" · "}
                  {link.koiboxServiceId !== null ? (
                    <span>{t("serviceLinked", { id: link.koiboxServiceId })}</span>
                  ) : missing ? (
                    <span className="text-destructive">{t("serviceMissing", { names: link.neededBy.join(", ") })}</span>
                  ) : (
                    <span className="text-muted-foreground">{t("serviceNotNeeded")}</span>
                  )}
                </span>
                {editing !== link.account && (
                  <Button type="button" variant="outline" size="sm" onClick={() => open(link)} disabled={saving}>
                    {link.koiboxServiceId !== null ? t("change") : t("link")}
                  </Button>
                )}
              </div>

              {editing === link.account && (
                <div className="space-y-3 rounded-lg bg-muted/50 p-3">
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium">{t("serviceLabel")}</span>
                    {loading ? (
                      <span className="block text-sm text-muted-foreground">{t("loadingServices")}</span>
                    ) : options ? (
                      <select value={choice} onChange={(e) => setChoice(e.target.value)} disabled={saving} className={fieldClass}>
                        <option value="">{t("pickService")}</option>
                        {options.map((o) => (
                          <option key={o.id} value={o.id}>
                            {t(o.minutes === props.durationMin ? "serviceOption" : "serviceOptionOther", {
                              name: o.name,
                              minutes: minutes(o.minutes),
                              id: o.id,
                            })}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        inputMode="numeric"
                        value={choice}
                        onChange={(e) => setChoice(e.target.value.replace(/\D/g, ""))}
                        disabled={saving}
                        placeholder="1234"
                        className={fieldClass}
                      />
                    )}
                    {failed && <span className="block text-sm text-muted-foreground">{t("servicesFailed")}</span>}
                  </label>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {link.koiboxServiceId !== null ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => save(link.account, null)}
                        disabled={saving}
                      >
                        {t("removeService")}
                      </Button>
                    ) : (
                      <span />
                    )}
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" onClick={() => setEditing(null)} disabled={saving}>
                        {t("cancel")}
                      </Button>
                      <Button type="button" onClick={() => onSave(link.account)} disabled={saving || loading}>
                        {saving ? t("saving") : t("save")}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {message && (
        <p role="status" className={message.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
          {message.text}
        </p>
      )}
    </li>
  );
}
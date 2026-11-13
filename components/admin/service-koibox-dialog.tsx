"use client";

import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { setServiceKoiboxLinkAction } from "@/app/[locale]/admin/(panel)/koibox/actions";
import { Button } from "@/components/ui/button";
import { StatusPill, textAction } from "./panel-ui";

type Option = { id: number; name: string; minutes: number | null };

export type ServiceCellDisplay =
  | { kind: "linked"; text: string } // enlazado y dura lo mismo
  | { kind: "review"; text: string } // enlazado, pero en Koibox dura distinto
  | { kind: "missing"; text: string } // alguien de esa cuenta lo hace y falta el id
  | { kind: "none" }; // nadie de esa cuenta lo hace

type Props = {
  serviceId: number;
  serviceName: string;
  durationMin: number;
  account: string;
  accountLabel: string;
  koiboxServiceId: number | null;
  display: ServiceCellDisplay;
  options: Option[] | null; // servicios de esa cuenta; null si no ha respondido
};

const fieldClass =
  "h-11 w-full rounded-lg border bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

// Una casilla de la tabla de Servicios (servicio × cuenta). Al pulsarla, se enlaza o se cambia.
export function ServiceKoiboxDialog(props: Props) {
  const t = useTranslations("Admin.koibox");
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [choice, setChoice] = useState(props.koiboxServiceId ? String(props.koiboxServiceId) : "");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const minutes = (m: number | null) => (m === null ? "?" : t("minutes", { count: m }));
  const d = props.display;

  function open() {
    setChoice(props.koiboxServiceId ? String(props.koiboxServiceId) : "");
    setError(null);
    dialog.current?.showModal();
  }

  function close() {
    dialog.current?.close();
  }

  function save(koiboxServiceId: number | null) {
    setError(null);
    startSaving(async () => {
      const result = await setServiceKoiboxLinkAction(props.serviceId, props.account, koiboxServiceId);
      if (result.ok) close();
      else setError(t(`errors.${result.error}`));
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = Number(choice);
    if (!Number.isInteger(id) || id <= 0) {
      setError(t("errors.pickService"));
      return;
    }
    save(id);
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="group inline-flex min-h-11 flex-col items-start justify-center gap-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
      >
        <span className="sr-only">{t("cellLabel", { service: props.serviceName, account: props.accountLabel })}: </span>
        {d.kind === "linked" && <span className="underline-offset-4 group-hover:underline">{d.text}</span>}
        {d.kind === "review" && (
          <>
            <StatusPill tone="wait">{t("review")}</StatusPill>
            <span className="text-xs text-muted-foreground group-hover:underline">{d.text}</span>
          </>
        )}
        {d.kind === "missing" && (
          <>
            <StatusPill tone="bad">{t("notLinkedShort")}</StatusPill>
            <span className="text-xs text-muted-foreground group-hover:underline">{d.text}</span>
          </>
        )}
        {d.kind === "none" && (
          <span className="text-muted-foreground group-hover:underline">
            <span aria-hidden>—</span>
            <span className="sr-only">{t("link")}</span>
          </span>
        )}
      </button>

      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border bg-card p-0 text-left text-foreground shadow-xl backdrop:bg-foreground/40"
      >
        <form onSubmit={onSubmit} className="space-y-4 p-5">
          <div className="space-y-1">
            <h2 id={titleId} className="text-lg font-semibold">
              {t("serviceDialogTitle", { service: props.serviceName, account: props.accountLabel })}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("serviceDialogHint", { minutes: minutes(props.durationMin) })}
            </p>
          </div>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{t("serviceLabel")}</span>
            {props.options ? (
              <select value={choice} onChange={(e) => setChoice(e.target.value)} disabled={saving} className={fieldClass}>
                <option value="">{t("pickService")}</option>
                {props.koiboxServiceId !== null && !props.options.some((o) => o.id === props.koiboxServiceId) && (
                  <option value={props.koiboxServiceId}>{t("serviceLinked", { id: props.koiboxServiceId })}</option>
                )}
                {props.options.map((o) => (
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
              <>
                <input
                  inputMode="numeric"
                  value={choice}
                  onChange={(e) => setChoice(e.target.value.replace(/\D/g, ""))}
                  disabled={saving}
                  placeholder="1234"
                  className={fieldClass}
                />
                <span className="block text-sm text-muted-foreground">{t("servicesFailed")}</span>
              </>
            )}
          </label>

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            {props.koiboxServiceId !== null ? (
              <button type="button" className={textAction("danger")} onClick={() => save(null)} disabled={saving}>
                {t("removeService")}
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
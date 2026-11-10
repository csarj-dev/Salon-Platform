"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { setStaffCollectorAction } from "@/app/[locale]/admin/(panel)/collectors/actions";
import { Button } from "@/components/ui/button";

type Option = { id: string; label: string };

type Props = {
  staffId: number;
  name: string;
  detail: string | null; // su cuenta de Koibox (o null si el salón no usa Koibox)
  saved: string | null; // su cobrador propio, solo si existe en el config
  currentLabel: string;
  source: "staff" | "account" | "default";
  ignored: string | null; // un id guardado que ya no existe
  fallbackLabel: string;
  followKey: "followAccount" | "followDefault";
  collectors: Option[];
};

const selectClass =
  "h-11 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-72";

export function StaffCollectorRow(props: Props) {
  const t = useTranslations("Admin.collectors");
  const initial = props.saved ?? "";
  const [selected, setSelected] = useState(initial);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await setStaffCollectorAction(props.staffId, selected === "" ? null : selected);
      setMessage(result.ok ? { ok: true, text: t("saved") } : { ok: false, text: t(`errors.${result.error}`) });
    });
  }

  const selectId = `collector-${props.staffId}`;

  return (
    <li className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{props.name}</p>
          {props.detail && <p className="text-sm text-muted-foreground">{props.detail}</p>}
        </div>
        <div className="text-right text-sm">
          <p className="font-medium">{t("chargedBy", { name: props.currentLabel })}</p>
          <p className="text-muted-foreground">{t(`source.${props.source}`)}</p>
        </div>
      </div>

      {props.ignored && <p className="text-sm text-destructive">{t("ignored", { id: props.ignored })}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={selectId} className="sr-only">
          {t("selectLabel", { name: props.name })}
        </label>
        <select
          id={selectId}
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={pending}
          className={selectClass}
        >
          <option value="">{t(props.followKey, { name: props.fallbackLabel })}</option>
          {props.collectors.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <Button type="button" onClick={save} disabled={pending || selected === initial}>
          {pending ? t("saving") : t("save")}
        </Button>
      </div>

      {message && (
        <p role="status" className={message.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
          {message.text}
        </p>
      )}
    </li>
  );
}
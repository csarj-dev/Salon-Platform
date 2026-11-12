"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { setStaffCollectorAction } from "@/app/[locale]/admin/(panel)/collectors/actions";
import { Dot } from "@/components/admin/panel-ui";
import { cn } from "@/lib/utils";

type Option = { id: string; label: string };

type Props = {
  staffId: number;
  name: string;
  detail: string | null; // su cuenta de Koibox (o null si el salón no usa Koibox)
  saved: string | null; // su cobrador propio, solo si existe en el config
  current: { label: string; color: string | null }; // quién cobra hoy
  source: "staff" | "account" | "default";
  ignored: string | null; // un id guardado que ya no existe
  fallbackLabel: string;
  followKey: "followAccount" | "followDefault";
  collectors: Option[];
};

// En ordenador, celdas de tabla; en el móvil, bloques apilados (la fila parece una tarjeta)
const cell = "block px-4 md:table-cell md:border-b md:py-3.5 md:align-middle";
const selectClass =
  "h-11 w-full rounded-lg border bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60";

// Quién cobra a una profesional. Se guarda al elegir en el desplegable.
export function StaffCollectorRow(props: Props) {
  const t = useTranslations("Admin.collectors");
  const [selected, setSelected] = useState(props.saved ?? "");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(value: string) {
    const previous = selected;
    setSelected(value);
    setMessage(null);
    startTransition(async () => {
      const result = await setStaffCollectorAction(props.staffId, value === "" ? null : value);
      if (result.ok) {
        setMessage({ ok: true, text: t("saved") });
      } else {
        // No se guardó: el desplegable vuelve a lo que había
        setSelected(previous);
        setMessage({ ok: false, text: t(`errors.${result.error}`) });
      }
    });
  }

  const selectId = `collector-${props.staffId}`;

  return (
    <tr className="block space-y-2 border-b py-4 last:border-b-0 md:table-row md:space-y-0 md:py-0 md:[&:last-child>td]:border-b-0">
      <td className={cell}>
        <p className="font-medium">{props.name}</p>
        {props.detail && <p className="text-xs text-muted-foreground">{props.detail}</p>}
      </td>
      <td className={cn(cell, "md:whitespace-nowrap")}>
        <span className="text-muted-foreground md:hidden">{t("table.collector")}: </span>
        <span className="inline-flex items-center gap-1.5">
          <Dot color={props.current.color} />
          {props.current.label}
        </span>
      </td>
      <td className={cell}>
        <p className="text-muted-foreground md:text-foreground">{t(`source.${props.source}`)}</p>
        {props.ignored && <p className="text-xs text-danger">{t("ignored", { id: props.ignored })}</p>}
      </td>
      <td className={cn(cell, "md:py-2.5")}>
        <label htmlFor={selectId} className="sr-only">
          {t("selectLabel", { name: props.name })}
        </label>
        <select
          id={selectId}
          value={selected}
          onChange={(e) => choose(e.target.value)}
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
        {(pending || message) && (
          <p
            role={message && !message.ok ? "alert" : "status"}
            className={cn("pt-1 text-xs", message && !message.ok ? "text-danger" : "text-muted-foreground")}
          >
            {pending ? t("saving") : message?.text}
          </p>
        )}
      </td>
    </tr>
  );
}
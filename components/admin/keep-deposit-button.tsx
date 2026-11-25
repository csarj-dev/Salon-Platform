"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { keepDepositAtTillAction } from "@/app/[locale]/admin/(panel)/appointments/actions";
import { textAction } from "@/components/admin/panel-ui";

// «Guardar el depósito»: la clienta paga en caja el servicio entero y se le guarda el depósito
// para otra cita (con correo de aviso), después de confirmarlo
export function KeepDepositButton({
  appointmentId, amount, until,
}: {
  appointmentId: number;
  amount: string; // «15,00 €»
  until: string; // hasta cuándo valdrá, ya formateado
}) {
  const t = useTranslations("Admin.actions");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    if (!window.confirm(t("confirmKeepAtTill", { amount, date: until }))) return;
    setError(null);
    startTransition(async () => {
      const result = await keepDepositAtTillAction(appointmentId);
      if (!result.ok) setError(t(`errors.${result.error}`));
    });
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" className={textAction()} disabled={pending} onClick={onClick}>
        {pending ? t("keepingAtTill") : t("keepAtTill")}
      </button>
      {error && (
        <span role="alert" className="text-sm text-destructive">
          {error}
        </span>
      )}
    </span>
  );
}
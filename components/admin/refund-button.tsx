"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { refundPaymentAction } from "@/app/[locale]/admin/(panel)/appointments/actions";
import { textAction } from "@/components/admin/panel-ui";

// «Devolver»: devuelve entero un pago con tarjeta, después de confirmarlo
export function RefundButton({ paymentId, amount }: { paymentId: number; amount: string }) {
  const t = useTranslations("Admin.actions");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    if (!window.confirm(t("confirmRefund", { amount }))) return;
    setError(null);
    startTransition(async () => {
      const result = await refundPaymentAction(paymentId);
      if (!result.ok) {
        const message = t(`errors.${result.error}`);
        setError(result.detail ? `${message} (${result.detail})` : message);
      }
    });
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" className={textAction()} disabled={pending} onClick={onClick}>
        {pending ? t("refunding") : t("refund", { amount })}
      </button>
      {error && (
        <span role="alert" className="text-sm text-destructive">
          {error}
        </span>
      )}
    </span>
  );
}
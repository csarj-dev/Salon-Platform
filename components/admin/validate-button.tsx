"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { validateDepositAction } from "@/app/[locale]/admin/(panel)/appointments/actions";
import { Button } from "@/components/ui/button";

export function ValidateButton({ appointmentId }: { appointmentId: number }) {
  const t = useTranslations("Admin.actions");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    if (!window.confirm(t("confirmValidate"))) return;
    setError(null);
    startTransition(async () => {
      const result = await validateDepositAction(appointmentId);
      if (!result.ok) setError(t(`errors.${result.error}`));
    });
  }

  return (
    <div className="space-y-1">
      <Button size="sm" disabled={pending} onClick={onClick}>
        {pending ? t("validating") : t("validate")}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { cancelByClientAction } from "@/app/[locale]/(site)/booking/confirmed/[token]/actions";
import { Button } from "@/components/ui/button";

type Props = {
  token: string;
  kind: "booked" | "pending";
  // Al anular a tiempo con el depósito pagado: el aviso de que se le guarda (ya con importe)
  keepNote?: string | null;
};

export function ClientCancel({ token, kind, keepNote = null }: Props) {
  const t = useTranslations("Confirmation");
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const label = kind === "booked" ? t("cancel") : t("cancelPending");

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await cancelByClientAction(token);
      if (result.ok) {
        setAsking(false);
        router.refresh();
      } else {
        setError(t(`cancelErrors.${result.error}`));
      }
    });
  }

  if (!asking) {
    return (
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="h-11 px-5"
        onClick={() => {
          setError(null);
          setAsking(true);
        }}
      >
        {label}
      </Button>
    );
  }

  return (
    <div role="group" aria-label={label} className="w-full space-y-3 rounded-lg border p-4">
      <p className="text-sm font-medium">{t(kind === "booked" ? "cancelConfirm" : "cancelPendingConfirm")}</p>
      {keepNote && (
        <p className="flex items-start gap-3 rounded-lg bg-success/10 p-3 text-sm leading-relaxed">
          <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-success text-xs text-white">
            ✓
          </span>
          <span>{keepNote}</span>
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="destructive" size="lg" className="h-11 px-5" onClick={confirm} disabled={pending}>
          {pending ? t("cancelling") : t("cancelYes")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="lg"
          className="h-11 px-5"
          onClick={() => setAsking(false)}
          disabled={pending}
        >
          {t("cancelNo")}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
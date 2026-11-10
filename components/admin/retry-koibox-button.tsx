"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { retryKoiboxAction } from "@/app/[locale]/admin/(panel)/appointments/actions";
import { Button } from "@/components/ui/button";

export function RetryKoiboxButton({ appointmentId }: { appointmentId: number }) {
  const t = useTranslations("Admin.card.koibox");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function onClick() {
    setMessage(null);
    startTransition(async () => {
      const result = await retryKoiboxAction(appointmentId);
      if (result.ok) setMessage({ ok: true, text: result.done ? t("retried") : t("nothing") });
      else if (result.error === "koibox") setMessage({ ok: false, text: t("errors.koibox", { message: result.message }) });
      else setMessage({ ok: false, text: t(`errors.${result.error}`) });
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={onClick} disabled={pending}>
        {pending ? t("retrying") : t("retry")}
      </Button>
      {message && (
        <span role="status" className={message.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
          {message.text}
        </span>
      )}
    </div>
  );
}
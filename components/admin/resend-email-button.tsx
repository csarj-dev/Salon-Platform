"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { resendEmailAction } from "@/app/[locale]/admin/(panel)/appointments/actions";
import { Button } from "@/components/ui/button";

export function ResendEmailButton({ appointmentId }: { appointmentId: number }) {
  const t = useTranslations("Admin");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function onClick() {
    setMessage(null);
    startTransition(async () => {
      const result = await resendEmailAction(appointmentId);
      setMessage(
        result.ok
          ? { ok: true, text: t("card.email.resent") }
          : { ok: false, text: t(`actions.errors.${result.error}`) },
      );
    });
  }

  return (
    <div className="space-y-1">
      <Button size="sm" variant="outline" disabled={pending} onClick={onClick}>
        {pending ? t("card.email.resending") : t("card.email.resend")}
      </Button>
      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={message.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
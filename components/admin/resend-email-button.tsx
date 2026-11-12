"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { resendEmailAction } from "@/app/[locale]/admin/(panel)/appointments/actions";
import { textAction } from "@/components/admin/panel-ui";

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
      <button type="button" className={textAction()} disabled={pending} onClick={onClick}>
        {pending ? t("card.email.resending") : t("card.email.resend")}
      </button>
      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={message.ok ? "text-sm text-muted-foreground" : "text-sm text-danger"}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
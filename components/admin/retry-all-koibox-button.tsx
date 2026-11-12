"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { retryAllKoiboxAction } from "@/app/[locale]/admin/(panel)/appointments/actions";
import { Button } from "@/components/ui/button";

export function RetryAllKoiboxButton() {
  const t = useTranslations("Admin.appointments.koibox");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function onClick() {
    setMessage(null);
    startTransition(async () => {
      const r = await retryAllKoiboxAction();
      setMessage(
        r.ok
          ? { ok: r.failed === 0, text: t("done", { checked: r.checked, fixed: r.fixed, failed: r.failed }) }
          : { ok: false, text: t(`errors.${r.error}`) },
      );
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" className="h-10 border-foreground bg-card px-4" onClick={onClick} disabled={pending}>
        {pending ? t("retryingAll") : t("retryAll")}
      </Button>
      {message && (
        <span role="status" className={message.ok ? "text-muted-foreground" : "text-danger"}>
          {message.text}
        </span>
      )}
    </div>
  );
}
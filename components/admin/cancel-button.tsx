"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { cancelAppointmentAction } from "@/app/[locale]/admin/(panel)/appointments/actions";
import { Button } from "@/components/ui/button";

export function CancelButton({ appointmentId }: { appointmentId: number }) {
  const t = useTranslations("Admin.actions");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "");
    setError(null);
    startTransition(async () => {
      const result = await cancelAppointmentAction(appointmentId, reason);
      if (!result.ok) setError(t(`errors.${result.error}`));
    });
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        {t("cancel")}
      </Button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="w-full space-y-2 rounded-lg border p-3">
      <label htmlFor={`reason-${appointmentId}`} className="text-sm font-medium">
        {t("reasonLabel")}
      </label>
      <textarea
        id={`reason-${appointmentId}`}
        name="reason"
        rows={2}
        maxLength={300}
        placeholder={t("reasonPlaceholder")}
        className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="destructive" disabled={pending}>
          {pending ? t("cancelling") : t("confirmCancel")}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          {t("back")}
        </Button>
      </div>
    </form>
  );
}
"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { rescheduleByClientAction } from "@/app/[locale]/(site)/booking/confirmed/[token]/actions";
import { Link, useRouter } from "@/i18n/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = { token: string; at: string; chooseOtherHref: string; doneHref: string };

export function RescheduleConfirm({ token, at, chooseOtherHref, doneHref }: Props) {
  const t = useTranslations("Reschedule");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await rescheduleByClientAction(token, at);
      if (result.ok) {
        router.replace(doneHref);
        router.refresh();
      } else {
        setError(t(`errors.${result.error}`));
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="lg" className="h-11 px-5" onClick={confirm} disabled={pending}>
          {pending ? t("confirming") : t("confirm")}
        </Button>
        <Link href={chooseOtherHref} className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "h-11 px-5")}>
          {t("chooseOther")}
        </Link>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
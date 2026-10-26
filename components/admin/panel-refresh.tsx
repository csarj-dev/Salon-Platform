"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AutoRefresh } from "@/components/auto-refresh";
import { Button } from "@/components/ui/button";

// Mantiene el panel al día: se actualiza solo cada 30 s (si la pestaña está a la vista y
// al volver a ella) y deja un botón para hacerlo a mano. Lo que se está escribiendo en
// formularios no se pierde al actualizar.
export function PanelRefresh() {
  const t = useTranslations("Admin.panel");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <>
      <AutoRefresh everyMs={30_000} stopAfterMs={Number.POSITIVE_INFINITY} />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        title={t("refreshHint")}
        onClick={() => startTransition(() => router.refresh())}
      >
        {pending ? t("refreshing") : t("refresh")}
      </Button>
    </>
  );
}
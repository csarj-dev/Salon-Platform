"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const t = useTranslations("Admin.panel");
  const router = useRouter();
  // Con Cache Components, Next guarda la cabecera oculta al salir del panel y la recupera al
  // volver con su estado. Un useState(true) se quedaría pegado; la transición se apaga sola.
  const [pending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      try {
        await authClient.signOut();
      } finally {
        router.replace("/admin/login");
        router.refresh();
      }
    });
  }

  return (
    <Button type="button" variant="outline" onClick={onClick} disabled={pending}>
      {t("signOut")}
    </Button>
  );
}
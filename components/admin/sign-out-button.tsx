"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const t = useTranslations("Admin.panel");
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    try {
      await authClient.signOut();
    } finally {
      router.replace("/admin/login");
      router.refresh();
    }
  }

  return (
    <Button type="button" variant="outline" onClick={onClick} disabled={pending}>
      {t("signOut")}
    </Button>
  );
}
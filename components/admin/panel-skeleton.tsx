import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";

type Props = { rows?: number };

/** Lo que se ve mientras llegan los datos de una página del panel. */
export function PanelSkeleton({ rows = 3 }: Props) {
  const t = useTranslations("Admin.panel");
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">{t("loading")}</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}
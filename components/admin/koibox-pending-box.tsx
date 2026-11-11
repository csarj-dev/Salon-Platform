import { getTranslations } from "next-intl/server";
import { RetryAllKoiboxButton } from "@/components/admin/retry-all-koibox-button";
import { formatDateTime } from "@/lib/format";
import type { KoiboxWork } from "@/lib/koibox/pending";

type Item = { id: number; clientName: string; startsAt: Date; lastError: string | null; work: KoiboxWork };

type Props = { items: Item[]; locale: string; zone: string; canRetry: boolean };

export async function KoiboxPendingBox({ items, locale, zone, canRetry }: Props) {
  if (items.length === 0) return null;
  const [t, tK] = await Promise.all([
    getTranslations({ locale, namespace: "Admin.appointments.koibox" }),
    getTranslations({ locale, namespace: "Admin.card.koibox" }),
  ]);
  const workText = (w: KoiboxWork) =>
    w.kind === "push"
      ? tK("work.push")
      : w.kind === "cleanup"
        ? tK("work.cleanup")
        : w.change.kind === "deposit_paid"
          ? tK("work.depositPaid")
          : w.change.kind === "deposit_expired"
            ? tK("work.depositExpired")
            : w.change.kind === "moved"
              ? tK("work.moved")
              : tK("work.cancelled");

  return (
    <div className="space-y-3 rounded-lg bg-amber-50 p-4 text-sm dark:bg-amber-950/30">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p>
          <span className="font-medium">{t("title", { count: items.length })}</span> {tK("auto")}
        </p>
        {canRetry && <RetryAllKoiboxButton />}
      </div>
      <details>
        <summary className="cursor-pointer font-medium">{t("show")}</summary>
        <ul className="mt-2 space-y-2">
          {items.map((i) => (
            <li key={i.id}>
              <span className="font-medium">
                {i.clientName} · {formatDateTime(i.startsAt, locale, zone)} · {t("reference", { id: i.id })}
              </span>
              <span className="block">{workText(i.work)}</span>
              {i.lastError && <span className="block text-muted-foreground">{tK("lastError", { error: i.lastError })}</span>}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
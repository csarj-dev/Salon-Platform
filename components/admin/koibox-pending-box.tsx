import { getTranslations } from "next-intl/server";
import { RetryAllKoiboxButton } from "@/components/admin/retry-all-koibox-button";
import { formatDateTime } from "@/lib/format";
import type { KoiboxWork } from "@/lib/koibox/pending";

type Item = { id: number; clientName: string; startsAt: Date; lastError: string | null; work: KoiboxWork };

type Props = { items: Item[]; locale: string; zone: string; canRetry: boolean };

// Aviso arriba de Citas: lo que no está al día en Koibox (lo mismo que mira el reintento automático)
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
    <div className="space-y-2 rounded-xl border-l-4 border-warning bg-warning/15 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p>
          <span className="font-semibold">{t("title", { count: items.length })}</span> {tK("auto")}
        </p>
        {canRetry && <RetryAllKoiboxButton />}
      </div>
      <details>
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium underline-offset-4 hover:underline">
          {t("show")}
        </summary>
        <ul className="space-y-3 border-t border-warning/25 pt-3">
          {items.map((i) => (
            <li key={i.id} className="space-y-0.5">
              <p className="font-medium">
                {i.clientName} · {formatDateTime(i.startsAt, locale, zone)} · {t("reference", { id: i.id })}
              </p>
              <p className="text-muted-foreground">{workText(i.work)}</p>
              {i.lastError && <p className="text-danger">{tK("lastError", { error: i.lastError })}</p>}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
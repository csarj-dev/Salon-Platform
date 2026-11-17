"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Photo } from "@/components/photo";
import { bookingHref } from "@/components/booking/step-ui";
import { buttonVariants } from "@/components/ui/button";
import { SERVICES_MAX } from "@/lib/booking-catalog";
import { depositForServices } from "@/lib/deposit";
import { formatDuration, formatPrice } from "@/lib/format";
import type { PhotoView } from "@/lib/photos";
import { cn } from "@/lib/utils";

export type PickerService = {
  id: number;
  name: string;
  description: string | null;
  durationMin: number;
  priceCents: number;
  depositCents: number | null;
  categoryId: number | null;
  photo: PhotoView | null;
};

export type PickerGroup = {
  key: string;
  name: string | null; // null = sin título (una sola categoría)
  services: PickerService[];
};

type Props = {
  locale: string;
  currency: string;
  locationId: number;
  groups: PickerGroup[];
  initial: number[]; // los que ya estaban marcados (al volver con «Cambiar»)
};

// Paso 2: se marcan uno o varios servicios (se hacen seguidos, en la misma visita).
// La barra de abajo suma tiempo, precio y depósito (uno por categoría) y lleva al paso siguiente.
export function ServicePicker({ locale, currency, locationId, groups, initial }: Props) {
  const t = useTranslations("Booking");
  const [selected, setSelected] = useState<number[]>(() => initial.slice(0, SERVICES_MAX));

  // El botón fijo de WhatsApp sube mientras está la barra, para no taparla
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--floating-offset", "4.75rem");
    return () => {
      root.style.removeProperty("--floating-offset");
    };
  }, []);

  const all = groups.flatMap((g) => g.services);
  // En el orden de la carta, se marquen en el orden que se marquen
  const chosen = all.filter((s) => selected.includes(s.id));
  const full = selected.length >= SERVICES_MAX;

  function toggle(id: number) {
    setSelected((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= SERVICES_MAX ? cur : [...cur, id],
    );
  }

  const minutes = chosen.reduce((sum, s) => sum + s.durationMin, 0);
  const price = chosen.reduce((sum, s) => sum + s.priceCents, 0);
  const deposit = depositForServices(chosen);
  const money = (cents: number) => formatPrice(cents, locale, currency);

  return (
    <>
      <p className="-mt-1 mb-4 text-sm text-muted-foreground">{t("pickHint")}</p>

      <div className="space-y-6">
        {groups.map((g) => (
          <div key={g.key} className="space-y-3">
            {g.name && (
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{g.name}</h3>
            )}
            {g.services.map((s) => {
              const on = selected.includes(s.id);
              const locked = !on && full;
              return (
                <label
                  key={s.id}
                  className={cn(
                    "flex items-center gap-4 rounded-xl border bg-card p-4 transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring",
                    on ? "border-foreground" : "hover:bg-muted/50",
                    locked ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                  )}
                >
                  {s.photo && (
                    <Photo photo={s.photo} ratio="1 / 1" sizes="64px" className="size-16 shrink-0 rounded-lg" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{s.name}</span>
                    {s.description && (
                      <span className="mt-1 block text-sm text-muted-foreground">{s.description}</span>
                    )}
                    <span className="mt-1 block text-sm text-muted-foreground">
                      {[
                        t("minutes", { count: s.durationMin }),
                        money(s.priceCents),
                        s.depositCents ? t("depositBadge", { amount: money(s.depositCents) }) : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={locked}
                    onChange={() => toggle(s.id)}
                    className="size-5 shrink-0 accent-primary"
                  />
                </label>
              );
            })}
          </div>
        ))}
      </div>

      {full && <p className="mt-3 text-sm text-muted-foreground">{t("pickMax", { count: SERVICES_MAX })}</p>}

      <div className="sticky bottom-0 z-40 -mx-6 mt-6 border-t bg-background/95 px-6 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 text-sm" aria-live="polite">
            {chosen.length === 0 ? (
              <p className="text-muted-foreground">{t("pickNone")}</p>
            ) : (
              <>
                <p className="font-medium">
                  {t("pickedSummary", { count: chosen.length, duration: formatDuration(minutes) })}
                </p>
                <p className="text-muted-foreground">
                  {money(price)}
                  {deposit ? ` · ${t("pickedDeposit", { amount: money(deposit) })}` : ""}
                </p>
              </>
            )}
          </div>
          {chosen.length > 0 ? (
            <Link
              href={bookingHref({ location: locationId, services: chosen.map((s) => s.id) })}
              className={cn(buttonVariants({ size: "lg" }), "h-11 px-6")}
            >
              {t("continue")}
            </Link>
          ) : (
            <span aria-disabled="true" className={cn(buttonVariants({ size: "lg" }), "pointer-events-none h-11 px-6 opacity-50")}>
              {t("continue")}
            </span>
          )}
        </div>
      </div>
    </>
  );
}
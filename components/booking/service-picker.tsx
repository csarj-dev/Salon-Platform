"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Photo } from "@/components/photo";
import {
  YourAppointment, summarizeServices, type PickedSummary, type SummaryLabels,
} from "@/components/booking/booking-shell";
import { bookingHref } from "@/components/booking/step-ui";
import { buttonVariants } from "@/components/ui/button";
import { SERVICES_MAX } from "@/lib/booking-catalog";
import { formatPrice } from "@/lib/format";
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

type PickerState = {
  groups: PickerGroup[];
  selected: number[];
  chosen: PickerService[]; // en el orden de la carta
  full: boolean;
  toggle: (id: number) => void;
};

const PickerContext = createContext<PickerState | null>(null);

function usePicker(): PickerState {
  const state = useContext(PickerContext);
  if (!state) throw new Error("ServicePickerList y ServicePickerAside van dentro de ServicePickerState");
  return state;
}

// Lo que está marcado, compartido por la lista (y su barra del móvil) y «Tu cita» del ordenador
export function ServicePickerState({
  groups,
  initial,
  children,
}: {
  groups: PickerGroup[];
  initial: number[]; // los que ya estaban marcados (al volver con «Cambiar»)
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<number[]>(() => initial.slice(0, SERVICES_MAX));
  // En el orden de la carta, se marquen en el orden que se marquen
  const chosen = groups.flatMap((g) => g.services).filter((s) => selected.includes(s.id));
  const full = selected.length >= SERVICES_MAX;
  const toggle = (id: number) =>
    setSelected((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= SERVICES_MAX ? cur : [...cur, id],
    );
  return (
    <PickerContext.Provider value={{ groups, selected, chosen, full, toggle }}>{children}</PickerContext.Provider>
  );
}

function useSummaryLabels(): SummaryLabels {
  const t = useTranslations("Booking");
  return {
    title: t("summaryTitle"),
    location: t("summaryLocation"),
    services: t("summaryServices"),
    staff: t("summaryStaff"),
    when: t("summaryWhen"),
    notChosen: t("summaryNotChosen"),
    change: t("change"),
    total: t("summaryTotal"),
    deposit: t("summaryDeposit"),
    noServices: t("summaryNoServices"),
  };
}

// «Seguir»: al paso de la profesional con los servicios marcados (desactivado si no hay ninguno)
function ContinueLink({ locationId, className }: { locationId: number; className?: string }) {
  const t = useTranslations("Booking");
  const { chosen } = usePicker();
  const classes = cn(buttonVariants({ size: "lg" }), "h-11 px-6", className);
  return chosen.length > 0 ? (
    <Link href={bookingHref({ location: locationId, services: chosen.map((s) => s.id) })} className={classes}>
      {t("continue")}
    </Link>
  ) : (
    <span aria-disabled="true" className={cn(classes, "pointer-events-none opacity-50")}>
      {t("continue")}
    </span>
  );
}

// Paso 2: las tarjetas con casilla y, en el móvil, la barra de abajo con lo que suman
export function ServicePickerList({
  locale,
  currency,
  locationId,
}: {
  locale: string;
  currency: string;
  locationId: number;
}) {
  const t = useTranslations("Booking");
  const { groups, selected, chosen, full, toggle } = usePicker();
  const money = (cents: number) => formatPrice(cents, locale, currency);
  const sum = chosen.length > 0 ? summarizeServices(chosen, locale, currency) : null;

  // En el móvil, el botón fijo de WhatsApp sube para no tapar la barra (en el ordenador no se mueve)
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--floating-offset", "4.75rem");
    return () => {
      root.style.removeProperty("--floating-offset");
    };
  }, []);

  return (
    <>
      <p className="-mt-1 mb-4 text-sm text-muted-foreground">{t("pickHint")}</p>

      <div className="space-y-6">
        {groups.map((g) => (
          <div key={g.key} className="space-y-3">
            {g.name && (
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{g.name}</h3>
            )}
            <div className="grid gap-3 lg:grid-cols-2">
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
          </div>
        ))}
      </div>

      {full && <p className="mt-3 text-sm text-muted-foreground">{t("pickMax", { count: SERVICES_MAX })}</p>}

      <div className="sticky bottom-0 z-40 -mx-6 mt-6 border-t bg-background/95 px-6 py-3 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 text-sm" aria-live="polite">
            {sum ? (
              <>
                <p className="font-medium">{t("pickedSummary", { count: chosen.length, duration: sum.duration })}</p>
                <p className="text-muted-foreground">
                  {sum.price}
                  {sum.deposit ? ` · ${t("pickedDeposit", { amount: sum.deposit })}` : ""}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">{t("pickNone")}</p>
            )}
          </div>
          <ContinueLink locationId={locationId} />
        </div>
      </div>
    </>
  );
}

// «Tu cita» del ordenador en el paso de servicios: se actualiza al marcar y lleva «Seguir»
export function ServicePickerAside({
  locale,
  currency,
  locationId,
  summary,
}: {
  locale: string;
  currency: string;
  locationId: number;
  summary: PickedSummary; // lo elegido antes (el local)
}) {
  const { chosen } = usePicker();
  const labels = useSummaryLabels();
  const live: PickedSummary = {
    ...summary,
    services: chosen.length > 0 ? summarizeServices(chosen, locale, currency) : undefined,
  };
  return <YourAppointment summary={live} labels={labels} footer={<ContinueLink locationId={locationId} className="w-full" />} />;
}
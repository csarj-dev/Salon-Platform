import type { ComponentProps, ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { flowQuery, type Flow } from "@/lib/booking-flow";

// Enlace a /booking con la selección indicada
// Enlace a /booking con la selección indicada. Con `hash`, la página baja a ese elemento
// (p. ej. "times": las horas del día elegido).
export const bookingHref = (flow: Flow, hash?: string) => ({
  pathname: "/booking",
  query: flowQuery(flow),
  ...(hash ? { hash } : {}),
});

export type BookingHref = ComponentProps<typeof Link>["href"];

export function Heading({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 text-lg font-medium">{children}</h2>;
}

// Una elección ya hecha, con su enlace para cambiarla. `caption`: qué es («Profesional»…)
export function Chosen({
  caption,
  label,
  changeHref,
  changeText,
}: {
  caption?: string;
  label: string;
  changeHref: BookingHref;
  changeText: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2 text-sm">
      <span className="min-w-0">
        {caption && <span className="block text-xs text-muted-foreground">{caption}</span>}
        <span className="block font-medium">{label}</span>
      </span>
      <Link href={changeHref} className="shrink-0 underline underline-offset-4">
        {changeText}
      </Link>
    </div>
  );
}

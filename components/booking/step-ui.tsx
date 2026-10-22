import type { ComponentProps, ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { flowQuery, type Flow } from "@/lib/booking-flow";

// Enlace a /booking con la selección indicada
export const bookingHref = (flow: Flow) => ({ pathname: "/booking", query: flowQuery(flow) });

export type BookingHref = ComponentProps<typeof Link>["href"];

export function Heading({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 text-lg font-medium">{children}</h2>;
}

// Una elección ya hecha, con su enlace para cambiarla
export function Chosen({
  label,
  changeHref,
  changeText,
}: {
  label: string;
  changeHref: BookingHref;
  changeText: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
      <span>{label}</span>
      <Link href={changeHref} className="text-muted-foreground underline underline-offset-4">
        {changeText}
      </Link>
    </div>
  );
}

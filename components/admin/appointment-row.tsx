"use client";

import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  grid: string; // ROW_GRID_KOIBOX o ROW_GRID_PLAIN (appointment-marks.ts)
  time: string;
  client: string;
  phone: string;
  service: string;
  sub: string; // "con Ana · cita #57"
  status: ReactNode; // la pastilla
  koibox: ReactNode | null; // punto + "Al día"; null si el salón no usa Koibox
  labels: { show: string; hide: string };
  children: ReactNode; // la ficha (AppointmentDetail), pintada en el servidor
};

// Una cita en la tabla de Citas. La flecha despliega su ficha debajo.
export function AppointmentRow(props: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <li className={cn("border-b last:border-b-0", open && "bg-muted/40")}>
      <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 md:min-h-15 md:gap-x-0 md:py-0", props.grid)}>
        <span className="w-14 shrink-0 text-base font-semibold md:w-auto">{props.time}</span>
        <span className="flex min-w-0 flex-1 flex-col md:flex-none md:pr-3">
          <span className="truncate font-medium">{props.client}</span>
          <span className="text-xs text-muted-foreground">{props.phone}</span>
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={open ? props.labels.hide : props.labels.show}
          className="ml-auto inline-flex size-11 cursor-pointer items-center justify-center rounded-lg outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring md:order-last md:ml-0 md:justify-self-end"
        >
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn("size-[1.125rem] transition-transform", open && "rotate-180")}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        <span className="flex w-full min-w-0 flex-col pl-[4.25rem] md:w-auto md:pl-0 md:pr-3">
          <span className="truncate">{props.service}</span>
          <span className="text-xs text-muted-foreground">{props.sub}</span>
        </span>
        <span className="pl-[4.25rem] md:pl-0">{props.status}</span>
        {props.koibox && <span>{props.koibox}</span>}
      </div>
      <div id={panelId} hidden={!open} className="px-4 pb-4">
        <div className="rounded-xl border bg-card p-4">{props.children}</div>
      </div>
    </li>
  );
}
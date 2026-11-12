"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

type Option = { id: number; name: string };

type Props = {
  staff: Option[];
  locations: Option[];
  labels: {
    search: string;
    searchPlaceholder: string;
    staff: string;
    allStaff: string;
    location: string;
    allLocations: string;
    searching: string;
  };
};

const fieldClass =
  "h-11 rounded-lg border bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const DEBOUNCE_MS = 300;

// Búsqueda y filtros de Citas. Todo va en la URL (?q, ?staff, ?location).
// Va fuera de la lista que se recarga: al buscar no se desmonta ni pierde lo escrito.
export function AppointmentFilters({ staff, locations, labels }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const urlQ = params.get("q") ?? "";
  const [text, setText] = useState(urlQ);
  const [sent, setSent] = useState(urlQ); // lo último que esta caja puso en la URL
  const [seenQ, setSeenQ] = useState(urlQ);
  // La URL cambió por otro lado ("Quitar filtros", una pestaña…): la caja se pone al día
  if (urlQ !== seenQ) {
    setSeenQ(urlQ);
    if (urlQ !== sent) {
      setText(urlQ);
      setSent(urlQ);
    }
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function navigate(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete("client"); // buscar o filtrar sale de la vista de una clienta
    const qs = next.toString();
    startTransition(() => router.replace(`/admin/appointments${qs ? `?${qs}` : ""}`, { scroll: false }));
  }

  function onText(value: string) {
    setText(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const q = value.trim();
      setSent(q);
      navigate({ q: q || null });
    }, DEBOUNCE_MS);
  }

  const staffValue = params.get("staff") ?? "";
  const locationValue = params.get("location") ?? "";

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex min-w-0 flex-[1_1_18rem] flex-col gap-1">
        <span className="sr-only">{labels.search}</span>
        <input
          type="search"
          value={text}
          onChange={(e) => onText(e.target.value)}
          placeholder={labels.searchPlaceholder}
          className={cn(fieldClass, "w-full")}
        />
      </label>
      {staff.length > 1 && (
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {labels.staff}
          <select
            key={staffValue}
            defaultValue={staffValue}
            onChange={(e) => navigate({ staff: e.target.value || null })}
            className={cn(fieldClass, "text-foreground")}
          >
            <option value="">{labels.allStaff}</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {locations.length > 1 && (
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {labels.location}
          <select
            key={locationValue}
            defaultValue={locationValue}
            onChange={(e) => navigate({ location: e.target.value || null })}
            className={cn(fieldClass, "text-foreground")}
          >
            <option value="">{labels.allLocations}</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <span
        role="status"
        aria-live="polite"
        className={cn("text-sm text-muted-foreground", pending ? "min-h-11 content-center" : "sr-only")}
      >
        {pending ? labels.searching : ""}
      </span>
    </div>
  );
}
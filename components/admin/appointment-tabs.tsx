"use client";

import { useSearchParams } from "next/navigation";
import { SegmentLinks } from "./panel-ui";

type Props = { tabs: { id: string; label: string }[]; label: string };

// Lo que se conserva al cambiar de pestaña (el día de los recuadros y la clienta, no)
const KEEP = ["q", "staff", "location"];

// Pestañas de Citas. Van fuera del <Suspense> de la lista: al cambiar de pestaña se quedan
// quietas mientras llega la lista nueva. La activa se lee de la URL (?tab=…).
export function AppointmentTabs({ tabs, label }: Props) {
  const params = useSearchParams();
  // En "Todas las citas de una clienta" no hay pestaña: salen todas
  const current = params.get("tab");
  const active = params.has("client") ? null : tabs.some((t) => t.id === current) ? current : tabs[0]?.id;

  const hrefFor = (id: string) => {
    const next = new URLSearchParams({ tab: id });
    for (const key of KEEP) {
      const value = params.get(key);
      if (value) next.set(key, value);
    }
    return `/admin/appointments?${next.toString()}`;
  };

  return (
    <SegmentLinks
      label={label}
      items={tabs.map((t) => ({ href: hrefFor(t.id), label: t.label, active: t.id === active }))}
    />
  );
}
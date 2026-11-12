"use client";

import { useSearchParams } from "next/navigation";
import { SegmentLinks } from "./panel-ui";

type Props = { tabs: { id: string; label: string }[]; label: string };

// Pestañas de Citas. Van fuera del <Suspense> de la lista: al cambiar de pestaña se quedan
// quietas mientras llega la lista nueva. La activa se lee de la URL (?tab=…).
export function AppointmentTabs({ tabs, label }: Props) {
  const current = useSearchParams().get("tab");
  const active = tabs.some((t) => t.id === current) ? current : tabs[0]?.id;
  return (
    <SegmentLinks
      label={label}
      items={tabs.map((t) => ({ href: `/admin/appointments?tab=${t.id}`, label: t.label, active: t.id === active }))}
    />
  );
}
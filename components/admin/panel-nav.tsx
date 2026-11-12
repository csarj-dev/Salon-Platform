"use client";

import { useEffect, useRef } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { segmentItem, segmentTrack } from "./panel-ui";

export type PanelNavItem = {
  href: string;
  label: string;
  count?: number; // «Depósitos · 2»
  countLabel?: string; // lo que oye un lector de pantalla: «2 depósitos pendientes»
};

// Secciones del panel en cápsula, con la activa marcada (también en sus subpáginas)
export function PanelNav({ items }: { items: PanelNavItem[] }) {
  const pathname = usePathname();
  const track = useRef<HTMLDivElement>(null);

  // En el móvil la cápsula se desliza: que la sección activa quede a la vista
  useEffect(() => {
    const el = track.current;
    const active = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!el || !active) return;
    const hiddenLeft = active.offsetLeft < el.scrollLeft;
    const hiddenRight = active.offsetLeft + active.offsetWidth > el.scrollLeft + el.clientWidth;
    if (hiddenLeft || hiddenRight) el.scrollTo({ left: active.offsetLeft - 4 });
  }, [pathname]);

  return (
    <div ref={track} className={segmentTrack}>
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={segmentItem(active)}
          >
            {item.label}
            {item.count ? (
              <>
                <span aria-hidden>&nbsp;·&nbsp;{item.count}</span>
                <span className="sr-only">, {item.countLabel}</span>
              </>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}
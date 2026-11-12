"use client";

import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { segmentItem, segmentTrack } from "./panel-ui";

type Tab = { id: string; label: string; content: ReactNode };

// Pestañas dentro de la página (sin navegar). Para las que dependen de la URL: SegmentLinks.
export function PanelTabs({ tabs, label }: { tabs: Tab[]; label: string }) {
  const base = useId();
  const [active, setActive] = useState(tabs[0]?.id);

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label={label} className={cn(segmentTrack, "w-fit")}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`${base}-tab-${tab.id}`}
            aria-selected={tab.id === active}
            aria-controls={`${base}-panel-${tab.id}`}
            onClick={() => setActive(tab.id)}
            className={cn(segmentItem(tab.id === active), "cursor-pointer")}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${base}-panel-${tab.id}`}
          aria-labelledby={`${base}-tab-${tab.id}`}
          hidden={tab.id !== active}
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
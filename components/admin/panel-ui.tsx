import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

// Piezas comunes del panel. Solo usan los colores
// del tema del salón (bg-card, text-muted-foreground, success / warning / danger…).

export type Tone = "ok" | "wait" | "bad" | "neutral";

const PILL_TONES: Record<Tone, string> = {
  ok: "bg-success/12 text-success",
  wait: "bg-warning/15 text-warning",
  bad: "bg-danger/12 text-danger",
  neutral: "bg-muted text-muted-foreground",
};

/** Pastilla de estado: «Confirmada», «Conectada», «Sin enlazar»… */
export function StatusPill({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap",
        PILL_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Punto de color de un cobrador o una cuenta. Sin color configurado, el del borde. */
export function Dot({ color, className }: { color?: string | null; className?: string }) {
  const style: CSSProperties = { backgroundColor: color ?? "var(--border)" };
  return <span aria-hidden className={cn("inline-block size-2.5 shrink-0 rounded-full", className)} style={style} />;
}

/** Título de la página, su explicación y, a la derecha, el botón principal si lo hay. */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 space-y-1">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description && <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** Caja con fondo de tarjeta y borde: tarjetas, tablas, secciones. */
export function Surface({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-xl border bg-card", className)} {...props} />;
}

/** Encabezado pequeño en versalitas (días en Citas, grupos de una lista). */
export function SectionLabel({ className, ...props }: ComponentProps<"h2">) {
  return (
    <h2
      className={cn("text-xs font-medium tracking-[0.06em] text-muted-foreground uppercase", className)}
      {...props}
    />
  );
}

// Pestañas en cápsula: las secciones del panel y las pestañas de cada página
// Sin barra de desplazamiento visible: en el móvil se desliza con el dedo.
// relative: así las posiciones de las pestañas se miden desde la cápsula (panel-nav.tsx)
export const segmentTrack =
  "relative flex max-w-full gap-1 overflow-x-auto rounded-md bg-muted p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

export function segmentItem(active: boolean) {
  return cn(
    "inline-flex min-h-10 shrink-0 items-center rounded-md px-3.5 text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
    active ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
  );
}

export type SegmentLink = { href: string; label: ReactNode; active: boolean };

/** Pestañas que son enlaces (?tab=…): la página sabe cuál está activa. */
export function SegmentLinks({ items, label, className }: { items: SegmentLink[]; label: string; className?: string }) {
  return (
    <nav aria-label={label} className={cn(segmentTrack, "self-start", className)}>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={segmentItem(item.active)}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
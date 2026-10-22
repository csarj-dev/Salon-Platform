import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { Photo } from "@/components/photo";
import type { PhotoView } from "@/lib/photos";

type Props = {
  name: string;
  description: string | null;
  duration: string; // ya formateado: "60 min"
  price: string; // ya formateado: "45,00 €"
  badge?: string; // p. ej. "Con consulta previa"
  action?: ReactNode;
  /** Miniatura; sin foto no se reserva hueco */
  photo?: PhotoView | null;
  /** Enlace a la página del servicio; solo si tiene contenido */
  detailHref?: string;
  detailLabel?: string;
};

export function ServiceRow({
  name, description, duration, price, badge, action, photo, detailHref, detailLabel,
}: Props) {
  return (
    <li className="py-4">
      <div className="flex gap-4">
        {photo && (
          <Photo
            photo={photo}
            ratio="1 / 1"
            sizes="80px"
            className="size-20 shrink-0 rounded-lg"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-4">
            <h3 className="font-medium">{name}</h3>
            <span className="shrink-0 font-medium tabular-nums">{price}</span>
          </div>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span>{duration}</span>
            {badge && <Badge variant="secondary">{badge}</Badge>}
            {detailHref && detailLabel && (
              <Link
                href={detailHref}
                className="inline-flex min-h-11 items-center underline underline-offset-4"
              >
                {detailLabel}
              </Link>
            )}
          </div>
        </div>
      </div>
      {action && <div className="mt-3">{action}</div>}
    </li>
  );
}
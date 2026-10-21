import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";

type Props = {
  name: string;
  description: string | null;
  duration: string; // ya formateado: "60 min"
  price: string; // ya formateado: "45,00 €"
  badge?: string; // p. ej. "Con consulta previa"
  action?: ReactNode;
};

export function ServiceRow({ name, description, duration, price, badge, action }: Props) {
  return (
    <li className="py-4">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="font-medium">{name}</h3>
        <span className="shrink-0 font-medium tabular-nums">{price}</span>
      </div>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>{duration}</span>
        {badge && <Badge variant="secondary">{badge}</Badge>}
      </div>
      {action && <div className="mt-3">{action}</div>}
    </li>
  );
}
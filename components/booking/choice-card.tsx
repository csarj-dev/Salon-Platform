import type { ComponentProps } from "react";
import { Link } from "@/i18n/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Photo } from "@/components/photo";
import type { PhotoView } from "@/lib/photos";
import { cn } from "@/lib/utils";

type Props = {
  href: ComponentProps<typeof Link>["href"];
  title: string;
  description?: string | null;
  meta?: string;
  /** Miniatura; si no hay, la tarjeta no reserva hueco para ella */
  photo?: PhotoView | null;
  /** Círculo con iniciales cuando no hay foto (profesionales) */
  initials?: string;
  /** Miniatura circular (profesionales) en lugar de cuadrada */
  round?: boolean;
};

export function ChoiceCard({ href, title, description, meta, photo, initials, round }: Props) {
  return (
    <Link
      href={href}
      className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="transition-colors hover:bg-muted/50">
        <CardContent className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {photo ? (
              <Photo
                photo={photo}
                ratio="1 / 1"
                sizes="64px"
                className={cn("size-16 shrink-0", round ? "rounded-full" : "rounded-lg")}
              />
            ) : initials ? (
              <div
                aria-hidden="true"
                className="flex size-16 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground"
              >
                {initials}
              </div>
            ) : null}
            <div>
              <p className="font-medium">{title}</p>
              {description && (
                <p className="mt-1 text-sm text-muted-foreground">{description}</p>
              )}
            </div>
          </div>
          {meta && <span className="shrink-0 text-sm text-muted-foreground">{meta}</span>}
        </CardContent>
      </Card>
    </Link>
  );
}
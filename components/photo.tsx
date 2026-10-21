import Image from "next/image";
import { cn } from "@/lib/utils";
import type { PhotoView } from "@/lib/photos";

type Props = {
  photo?: PhotoView | null;
  /** Describe el bloque gris para lectores de pantalla; sin esto el marcador se oculta */
  fallbackAlt?: string;
  /** Proporción CSS, p. ej. "4 / 5". Por defecto, la de la foto (o 4 / 3 en gris) */
  ratio?: string;
  sizes?: string;
  priority?: boolean;
  className?: string;
};

export function Photo({
  photo,
  fallbackAlt,
  ratio,
  sizes = "(min-width: 768px) 33vw, 100vw",
  priority,
  className,
}: Props) {
  const aspectRatio = ratio ?? (photo ? `${photo.width} / ${photo.height}` : "4 / 3");

  if (!photo) {
    return (
      <div
        {...(fallbackAlt
          ? { role: "img", "aria-label": fallbackAlt }
          : { "aria-hidden": true })}
        className={cn("bg-muted", className)}
        style={{ aspectRatio }}
      />
    );
  }

  return (
    <div className={cn("relative overflow-hidden bg-muted", className)} style={{ aspectRatio }}>
      <Image
        src={photo.src}
        alt={photo.alt}
        fill
        sizes={sizes}
        priority={priority}
        className="object-cover"
      />
    </div>
  );
}
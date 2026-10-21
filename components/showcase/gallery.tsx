import Image from "next/image";
import type { GalleryItem } from "@/lib/salon-config";

type Props = {
  items: GalleryItem[];
  locale: string;
  defaultLocale: string;
};

export function Gallery({ items, locale, defaultLocale }: Props) {
  if (items.length === 0) return null;

  return (
    <ul className="grid grid-cols-2 gap-2 md:grid-cols-3">
      {items.map((item, i) => {
        const alt = item.alt[locale] ?? item.alt[defaultLocale] ?? "";
        const frame = { aspectRatio: `${item.width} / ${item.height}` };

        return (
          <li key={item.src ?? i} className="overflow-hidden rounded-lg">
            {item.src ? (
              <div className="relative" style={frame}>
                <Image
                  src={item.src}
                  alt={alt}
                  fill
                  sizes="(min-width: 768px) 33vw, 50vw"
                  className="object-cover"
                />
              </div>
            ) : (
              // Marcador de posición: un bloque gris que un lector de pantalla describe con el mismo alt
              <div role="img" aria-label={alt} className="bg-muted" style={frame} />
            )}
          </li>
        );
      })}
    </ul>
  );
}
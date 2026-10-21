import Image from "next/image";
import type { ReactNode } from "react";
import type { HeroConfig } from "@/lib/salon-config";
import { cn } from "@/lib/utils";

type Props = {
  title: string;
  tagline: string;
  hero?: HeroConfig;
  locale: string;
  defaultLocale: string;
  children: ReactNode; // el botón principal
};

export function Hero({ title, tagline, hero, locale, defaultLocale, children }: Props) {
  const alt = hero ? (hero.alt[locale] ?? hero.alt[defaultLocale] ?? "") : "";
  const hasPhoto = Boolean(hero?.src);

  return (
    <section
      className={cn(
        // isolate: el fondo y el degradado (z negativo) quedan detrás del texto, dentro de esta sección
        "relative isolate flex items-end justify-center overflow-hidden",
        hero && "min-h-[70svh]",
      )}
    >
      {hero?.src ? (
        <>
         <Image
            src={hero.src}
            alt={alt}
            fill
            priority
            sizes="100vw"
            style={{ objectPosition: hero.focus }}
            className="-z-10 object-cover"
          />
          {/* Degradado oscuro abajo para que el texto blanco se lea sobre cualquier foto */}
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 bg-linear-to-t from-black/70 via-black/30 to-transparent"
          />
        </>
      ) : hero ? (
        <div role="img" aria-label={alt} className="absolute inset-0 -z-10 bg-muted" />
      ) : null}

      <div className={cn("w-full max-w-3xl px-6 py-16 text-center", hasPhoto && "text-white")}>
        <h1 className="text-4xl font-semibold tracking-tight">{title}</h1>
        <p
          className={cn(
            "mx-auto mt-4 max-w-md",
            hasPhoto ? "text-white/85" : "text-muted-foreground",
          )}
        >
          {tagline}
        </p>
        <div className="mt-8 flex justify-center">{children}</div>
      </div>
    </section>
  );
}
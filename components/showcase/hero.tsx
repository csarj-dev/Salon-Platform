import { getImageProps } from "next/image";
import type { CSSProperties, ReactNode } from "react";
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

// Imagen de portada con una versión distinta para móvil (art direction, ver docs de next/image)
function HeroPicture({ hero, src, alt }: { hero: HeroConfig; src: string; alt: string }) {
  const common = { alt, sizes: "100vw", priority: true } as const;

  const desktop = getImageProps({ ...common, src, width: hero.width, height: hero.height });
  const mobile = hero.mobile
    ? getImageProps({
        ...common,
        src: hero.mobile.src,
        width: hero.mobile.width,
        height: hero.mobile.height,
      })
    : null;

  const { srcSet: desktopSrcSet, ...desktopRest } = desktop.props;

  return (
    <picture>
      {mobile && <source media="(max-width: 767px)" srcSet={mobile.props.srcSet} />}
      <img
        {...desktopRest}
        srcSet={desktopSrcSet}
        alt={alt}
        style={{ "--hero-focus": hero.focus } as CSSProperties}
        className="absolute inset-0 -z-10 h-full w-full object-cover object-top md:[object-position:var(--hero-focus,center)]"
      />
    </picture>
  );
}

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
          <HeroPicture hero={hero} src={hero.src} alt={alt} />
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
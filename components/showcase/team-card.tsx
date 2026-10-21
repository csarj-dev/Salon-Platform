import { Link } from "@/i18n/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Photo } from "@/components/photo";
import type { PhotoView } from "@/lib/photos";

type Props = {
  name: string;
  role: string | null;
  bio: string | null;
  photo?: PhotoView | null;
  initials: string;
  /** Locales donde trabaja; vacío u omitido = no se muestra la línea */
  locations?: { name: string; slug: string | null }[];
  worksAtLabel?: string;
  /** Nivel del título: h2 en la página del equipo, h3 dentro de otra sección */
  as?: "h2" | "h3";
};

export function TeamCard({
  name, role, bio, photo, initials, locations, worksAtLabel, as: Heading = "h3",
}: Props) {
  return (
    <Card>
      <CardContent className="space-y-3">
        {photo ? (
          <Photo
            photo={photo}
            ratio="4 / 5"
            sizes="(min-width: 640px) 50vw, 100vw"
            className="rounded-lg"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex aspect-[4/5] items-center justify-center rounded-lg bg-muted text-4xl font-medium text-muted-foreground"
          >
            {initials}
          </div>
        )}

        <div>
          <Heading className="text-lg font-medium">{name}</Heading>
          {role && <p className="text-sm text-muted-foreground">{role}</p>}
        </div>

        {bio && <p className="text-sm">{bio}</p>}

        {worksAtLabel && locations && locations.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {worksAtLabel}:{" "}
            {locations.map((l, i) => (
              <span key={l.name}>
                {i > 0 && ", "}
                {l.slug ? (
                  <Link href={`/locations/${l.slug}`} className="underline underline-offset-4">
                    {l.name}
                  </Link>
                ) : (
                  l.name
                )}
              </span>
            ))}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
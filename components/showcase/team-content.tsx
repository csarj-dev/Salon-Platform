import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { TeamCard } from "@/components/showcase/team-card";
import { listTeam } from "@/lib/catalog";
import { initialsOf } from "@/lib/initials";
import { getPhotoViews } from "@/lib/photos";
import { loadSalonConfig } from "@/lib/salon-config";

export async function TeamContent({ locale }: { locale: string }) {
  const [config, t] = await Promise.all([
    loadSalonConfig(),
    getTranslations({ locale, namespace: "Team" }),
  ]);

  const team = await listTeam(locale, config.defaultLocale);
  if (team.length === 0) notFound();

  const photos = await getPhotoViews(
    team.map((m) => m.photoId),
    locale,
    config.defaultLocale,
  );

  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {team.map((m) => (
        <li key={m.id}>
          <TeamCard
            as="h2"
            name={m.name}
            role={m.role}
            bio={m.bio}
            photo={m.photoId === null ? undefined : photos.get(m.photoId)}
            initials={initialsOf(m.name)}
            locations={m.locations}
            worksAtLabel={t("worksAt")}
          />
        </li>
      ))}
    </ul>
  );
}
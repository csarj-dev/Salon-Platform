import { getTranslations } from "next-intl/server";
import { ChoiceCard } from "@/components/booking/choice-card";
import { DateTimeStep } from "@/components/booking/date-time-step";
import { Chosen, Heading, bookingHref } from "@/components/booking/step-ui";
import {
  listActiveLocations, listServicesForLocation, listStaffForService,
} from "@/lib/catalog";
import { parseFlowParams } from "@/lib/booking-flow";
import { formatPrice } from "@/lib/format";
import { initialsOf } from "@/lib/initials";
import { getPhotoViews } from "@/lib/photos";
import { loadSalonConfig } from "@/lib/salon-config";
import { io } from "next/cache";

type Props = {
  locale: string;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const href = bookingHref;

export async function BookingSteps({ locale, searchParams }: Props) {
  const [raw, config, t] = await Promise.all([
    searchParams,
    loadSalonConfig(),
    getTranslations("Booking"),
  ]);
  const flow = parseFlowParams(raw);
  // La hora actual se lee después de la URL (dato de la petición): así no se intenta prerenderizar
  // Next prerenderiza lo que puede; la hora actual cambia en cada visita, así que se excluye
  // del prerenderizado con io() antes de leerla
  await io();
  const now = new Date();

  // Paso 1: local (se omite si solo hay uno)
  const locations = await listActiveLocations();
  if (locations.length === 0) {
    return <p className="text-muted-foreground">{t("noLocations")}</p>;
  }
  const location =
    locations.length === 1 ? locations[0] : locations.find((l) => l.id === flow.location);

  if (!location) {
    const photos = await getPhotoViews(
      locations.map((l) => l.photoId),
      locale,
      config.defaultLocale,
    );
    return (
      <section>
        <Heading>{t("stepLocation")}</Heading>
        <div className="space-y-3">
          {locations.map((l) => (
            <ChoiceCard
              key={l.id}
              href={href({ location: l.id })}
              title={l.name}
              description={l.address}
              photo={l.photoId === null ? undefined : photos.get(l.photoId)}
            />
          ))}
        </div>
      </section>
    );
  }

  const summary: React.ReactNode[] = [];
  if (locations.length > 1) {
    summary.push(
      <Chosen key="loc" label={location.name} changeHref={href({})} changeText={t("change")} />,
    );
  }

  // Paso 2: servicio
  const services = (
    await listServicesForLocation(location.id, locale, config.defaultLocale)
  ).filter((s) => !s.requiresConsultation);
  const service = services.find((s) => s.id === flow.service);

  if (!service) {
    const photos = await getPhotoViews(
      services.map((s) => s.photoId),
      locale,
      config.defaultLocale,
    );
    return (
      <div className="space-y-6">
        <div className="space-y-2">{summary}</div>
        <section>
          <Heading>{t("stepService")}</Heading>
          {services.length === 0 ? (
            <p className="text-muted-foreground">{t("noServices")}</p>
          ) : (
            <div className="space-y-3">
              {services.map((s) => (
                <ChoiceCard
                  key={s.id}
                  href={href({ location: location.id, service: s.id })}
                  title={s.name}
                  description={s.description}
                  meta={[
                    t("minutes", { count: s.durationMin }),
                    formatPrice(s.priceCents, locale, config.currency),
                    s.depositCents
                      ? t("depositBadge", {
                          amount: formatPrice(s.depositCents, locale, config.currency),
                        })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  photo={s.photoId === null ? undefined : photos.get(s.photoId)}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    );
  }

  summary.push(
    <Chosen
      key="svc"
      label={service.name}
      changeHref={href({ location: location.id })}
      changeText={t("change")}
    />,
  );

  // Paso 3: profesional
  const team = await listStaffForService(location.id, service.id);
  const member = flow.staff === "any" ? "any" : team.find((m) => m.id === flow.staff);

  if (!member) {
    const photos = await getPhotoViews(
      team.map((m) => m.photoId),
      locale,
      config.defaultLocale,
    );
    return (
      <div className="space-y-6">
        <div className="space-y-2">{summary}</div>
        <section>
          <Heading>{t("stepStaff")}</Heading>
          {team.length === 0 ? (
            <p className="text-muted-foreground">{t("noStaff")}</p>
          ) : (
            <div className="space-y-3">
              <ChoiceCard
                href={href({ location: location.id, service: service.id, staff: "any" })}
                title={t("anyStaff")}
                description={t("anyStaffHint")}
              />
              {team.map((m) => (
                <ChoiceCard
                  key={m.id}
                  href={href({ location: location.id, service: service.id, staff: m.id })}
                  title={m.name}
                  photo={m.photoId === null ? undefined : photos.get(m.photoId)}
                  initials={initialsOf(m.name)}
                  round
                />
              ))}
            </div>
          )}
        </section>
      </div>
    );
  }

  summary.push(
    <Chosen
      key="staff"
      label={member === "any" ? t("anyStaff") : member.name}
      changeHref={href({ location: location.id, service: service.id })}
      changeText={t("change")}
    />,
  );

  // Pasos 4 y 5: día y hora, y datos de la clienta
  return (
    <DateTimeStep
      locale={locale}
      config={config}
      now={now}
      flow={flow}
      location={location}
      service={service}
      member={member === "any" ? "any" : { id: member.id, name: member.name }}
      summary={summary}
    />
  );
}

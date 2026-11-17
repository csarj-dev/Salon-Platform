import { getTranslations } from "next-intl/server";
import { ChoiceCard } from "@/components/booking/choice-card";
import {
  BookingShell, PickedRows, YourAppointment, summarizeServices,
  type PickedSummary, type StepNames, type SummaryLabels,
} from "@/components/booking/booking-shell";
import { DateTimeStep } from "@/components/booking/date-time-step";
import {
  ServicePickerAside, ServicePickerList, ServicePickerState, type PickerGroup,
} from "@/components/booking/service-picker";
import { Heading, bookingHref } from "@/components/booking/step-ui";
import { listActiveLocations, listServicesByCategory, listStaffForService } from "@/lib/catalog";
import { parseFlowParams } from "@/lib/booking-flow";
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

  const names: StepNames = {
    aria: t("stepsLabel"),
    steps: [t("stepsServices"), t("stepsStaff"), t("stepsWhen"), t("stepsDetails")],
  };
  const labels: SummaryLabels = {
    title: t("summaryTitle"),
    location: t("summaryLocation"),
    services: t("summaryServices"),
    staff: t("summaryStaff"),
    when: t("summaryWhen"),
    notChosen: t("summaryNotChosen"),
    change: t("change"),
    total: t("summaryTotal"),
    deposit: t("summaryDeposit"),
    noServices: t("summaryNoServices"),
  };

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
      <BookingShell step={1} names={names}>
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
      </BookingShell>
    );
  }

  const summary: PickedSummary = {
    location: { name: location.name, changeHref: locations.length > 1 ? href({}) : undefined },
  };

  // Paso 2: servicios. Se pueden marcar varios: se hacen seguidos, en la misma visita.
  const groups = (await listServicesByCategory(location.id, locale, config.defaultLocale))
    .map((g) => ({ ...g, services: g.services.filter((s) => !s.requiresConsultation) }))
    .filter((g) => g.services.length > 0);
  const catalog = groups.flatMap((g) => g.services);
  // Los elegidos, en el orden de la carta. Si alguno ya no se ofrece aquí, se vuelve a elegir.
  const wanted = flow.services ?? [];
  const services = catalog.filter((s) => wanted.includes(s.id));

  if (services.length === 0 || services.length !== wanted.length) {
    const photos = await getPhotoViews(
      catalog.map((s) => s.photoId),
      locale,
      config.defaultLocale,
    );
    const pickerGroups: PickerGroup[] = groups.map((g) => ({
      key: g.categoryId === null ? "none" : String(g.categoryId),
      // Con una sola categoría sobra el título
      name: groups.length > 1 ? (g.name ?? t("otherServices")) : null,
      services: g.services.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        durationMin: s.durationMin,
        priceCents: s.priceCents,
        depositCents: s.depositCents,
        categoryId: s.categoryId,
        photo: s.photoId === null ? null : (photos.get(s.photoId) ?? null),
      })),
    }));
    // Al volver con «Cambiar», los que ya tenía marcados
    const initial = (flow.picked ?? wanted).filter((id) => catalog.some((s) => s.id === id));
    return (
      <ServicePickerState groups={pickerGroups} initial={initial}>
        <BookingShell
          step={1}
          names={names}
          picked={<PickedRows summary={summary} labels={labels} />}
          aside={
            <ServicePickerAside locale={locale} currency={config.currency} locationId={location.id} summary={summary} />
          }
        >
          <section>
            <Heading>{t("stepService")}</Heading>
            {catalog.length === 0 ? (
              <p className="text-muted-foreground">{t("noServices")}</p>
            ) : (
              <ServicePickerList locale={locale} currency={config.currency} locationId={location.id} />
            )}
          </section>
        </BookingShell>
      </ServicePickerState>
    );
  }

  const ids = services.map((s) => s.id);
  summary.services = summarizeServices(services, locale, config.currency, href({ location: location.id, picked: ids }));

  // Paso 3: profesional (solo las que hacen todos los servicios elegidos)
  const team = await listStaffForService(location.id, ids);
  const member = flow.staff === "any" ? "any" : team.find((m) => m.id === flow.staff);

  if (!member) {
    const photos = await getPhotoViews(
      team.map((m) => m.photoId),
      locale,
      config.defaultLocale,
    );
    return (
      <BookingShell
        step={2}
        names={names}
        picked={<PickedRows summary={summary} labels={labels} />}
        aside={<YourAppointment summary={summary} labels={labels} />}
      >
        <section>
          <Heading>{t("stepStaff")}</Heading>
          {team.length === 0 ? (
            <p className="text-muted-foreground">
              {services.length > 1 ? t("noStaffTogether") : t("noStaff")}
            </p>
          ) : (
            <div className="space-y-3">
              {services.length > 1 && <p className="text-sm text-muted-foreground">{t("staffDoesAll")}</p>}
              <ChoiceCard
                href={href({ location: location.id, services: ids, staff: "any" })}
                title={t("anyStaff")}
                description={t("anyStaffHint")}
              />
              {team.map((m) => (
                <ChoiceCard
                  key={m.id}
                  href={href({ location: location.id, services: ids, staff: m.id })}
                  title={m.name}
                  photo={m.photoId === null ? undefined : photos.get(m.photoId)}
                  initials={initialsOf(m.name)}
                  round
                />
              ))}
            </div>
          )}
        </section>
      </BookingShell>
    );
  }

  summary.staff = {
    name: member === "any" ? t("anyStaff") : member.name,
    changeHref: href({ location: location.id, services: ids }),
  };

  // Pasos 4 y 5: día y hora, y datos de la clienta
  return (
    <DateTimeStep
      locale={locale}
      config={config}
      now={now}
      flow={flow}
      location={location}
      services={services}
      member={member === "any" ? "any" : { id: member.id, name: member.name }}
      summary={summary}
      labels={labels}
      names={names}
    />
  );
}
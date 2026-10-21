import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ChoiceCard } from "@/components/booking/choice-card";
import {
  listActiveLocations, listServicesForLocation, listStaffForService,
} from "@/lib/catalog";
import { flowQuery, parseFlowParams, type Flow } from "@/lib/booking-flow";
import { formatPrice } from "@/lib/format";
import { loadSalonConfig } from "@/lib/salon-config";

type Props = {
  locale: string;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const href = (flow: Flow) => ({ pathname: "/booking", query: flowQuery(flow) });

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-lg font-medium">{children}</h2>;
}

function Chosen({
  label,
  changeHref,
  changeText,
}: {
  label: string;
  changeHref: ReturnType<typeof href>;
  changeText: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
      <span>{label}</span>
      <Link href={changeHref} className="text-muted-foreground underline underline-offset-4">
        {changeText}
      </Link>
    </div>
  );
}

export async function BookingSteps({ locale, searchParams }: Props) {
  const [raw, config, t] = await Promise.all([
    searchParams,
    loadSalonConfig(),
    getTranslations("Booking"),
  ]);
  const flow = parseFlowParams(raw);

  // Paso 1: local (se omite si solo hay uno)
  const locations = await listActiveLocations();
  if (locations.length === 0) {
    return <p className="text-muted-foreground">{t("noLocations")}</p>;
  }
  const location =
    locations.length === 1 ? locations[0] : locations.find((l) => l.id === flow.location);

  if (!location) {
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
                  meta={`${t("minutes", { count: s.durationMin })} · ${formatPrice(
                    s.priceCents,
                    locale,
                    config.currency,
                  )}`}
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

  // Paso 4 (siguiente): día y hora
  return (
    <div className="space-y-6">
      <div className="space-y-2">{summary}</div>
      <p className="text-muted-foreground">{t("nextStep")}</p>
    </div>
  );
}
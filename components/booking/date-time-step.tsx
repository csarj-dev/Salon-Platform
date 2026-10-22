import type { ReactNode } from "react";
import { DateTime } from "luxon";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { BookingForm } from "@/components/booking/booking-form";
import { Chosen, Heading, bookingHref } from "@/components/booking/step-ui";
import { getAvailabilityForService, type ServiceAvailability } from "@/lib/availability-service";
import type { Flow } from "@/lib/booking-flow";
import type { CatalogService } from "@/lib/catalog";
import { formatDateTime, formatDayChip, formatDayLong, formatPrice, formatTime } from "@/lib/format";
import { toAvailabilityOptions, type SalonConfig } from "@/lib/salon-config";
import { cn } from "@/lib/utils";

const DAYS_SHOWN = 7;
const DAY_FORMAT = "yyyy-MM-dd";

type Props = {
  locale: string;
  config: SalonConfig;
  now: Date;
  flow: Flow;
  location: { id: number; name: string };
  service: CatalogService;
  member: "any" | { id: number; name: string };
  // Elecciones anteriores (local, servicio, profesional), ya pintadas
  summary: ReactNode[];
};

// Pasos 4 y 5: primero se elige el día y la hora; con la hora elegida, se piden los datos
export async function DateTimeStep({
  locale, config, now, flow, location, service, member, summary,
}: Props) {
  const t = await getTranslations("Booking");
  const zone = config.timezone;
  const opts = toAvailabilityOptions(config);

  // Primer y último día en los que se puede reservar (en la fecha local del salón)
  const today = DateTime.fromJSDate(now, { zone }).startOf("day");
  const last = today.plus({ days: config.booking.maxDaysAhead });

  // La semana que se muestra: la de la URL, sin salirse del rango reservable
  let start = flow.from ? DateTime.fromISO(flow.from, { zone }) : today;
  if (start < today) start = today;
  if (start > last) start = last;
  const days: DateTime[] = [];
  for (let i = 0; i < DAYS_SHOWN; i++) {
    const d = start.plus({ days: i });
    if (d > last) break;
    days.push(d);
  }
  const startIso = start.toFormat(DAY_FORMAT);

  // Huecos de cada día. Para "cualquiera" se juntan los de todas las profesionales.
  const slotsOf = (a: ServiceAvailability): Date[] =>
    member === "any"
      ? a.any.map((s) => s.startsAt)
      : (a.perStaff.find((s) => s.staffId === member.id)?.slots ?? []);

  const week = await Promise.all(
    days.map(async (day) => {
      const iso = day.toFormat(DAY_FORMAT);
      const availability = await getAvailabilityForService(location.id, service.id, iso, opts, now);
      return { day, iso, slots: slotsOf(availability) };
    }),
  );

  const base: Flow = {
    location: location.id,
    service: service.id,
    staff: member === "any" ? "any" : member.id,
  };

  // ---- Paso 5: con la hora elegida (y comprobando que sigue libre) ----
  if (flow.at) {
    const at = new Date(flow.at);
    const atIso = DateTime.fromJSDate(at, { zone }).toFormat(DAY_FORMAT);
    const known = week.find((w) => w.iso === atIso);
    const slots =
      known?.slots ??
      slotsOf(await getAvailabilityForService(location.id, service.id, atIso, opts, now));

    if (slots.some((s) => s.getTime() === at.getTime())) {
      return (
        <div className="space-y-6">
          <div className="space-y-2">
            {summary}
            <Chosen
              key="when"
              label={formatDateTime(at, locale, zone)}
              changeHref={bookingHref({ ...base, from: startIso, date: atIso })}
              changeText={t("change")}
            />
          </div>
          <section>
            <Heading>{t("stepDetails")}</Heading>
            {service.depositCents ? (
              <p className="mb-4 rounded-lg border bg-muted/50 p-3 text-sm">
                {t("depositNotice", {
                  amount: formatPrice(service.depositCents, locale, config.currency),
                  hours: config.booking.deposit.holdHours,
                })}
              </p>
            ) : null}
            <BookingForm
              locale={locale}
              locationId={location.id}
              serviceId={service.id}
              staff={member === "any" ? "any" : String(member.id)}
              at={flow.at}
              backHref={bookingHref({ ...base, from: startIso, date: atIso })}
            />
          </section>
        </div>
      );
    }
    // Si el hueco ya no existe (alguien lo reservó, o la URL está manipulada), se vuelve a elegir
  }

  // ---- Paso 4: día y hora ----
  const withSlots = week.filter((w) => w.slots.length > 0);
  const selected =
    week.find((w) => w.iso === flow.date && w.slots.length > 0) ?? withSlots[0] ?? null;

  const prevStart = start > today ? DateTime.max(today, start.minus({ days: DAYS_SHOWN })) : null;
  const nextStart = start.plus({ days: DAYS_SHOWN }) <= last ? start.plus({ days: DAYS_SHOWN }) : null;
  const weekHref = (d: DateTime) => bookingHref({ ...base, from: d.toFormat(DAY_FORMAT) });

  const navClass =
    "inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline";

  return (
    <div className="space-y-6">
      <div className="space-y-2">{summary}</div>
      <section>
        <Heading>{t("stepDate")}</Heading>

        <ul className="grid grid-cols-7 gap-1" aria-label={t("daysLabel")}>
          {week.map(({ day, iso, slots }, i) => {
            const chip = formatDayChip(day.toJSDate(), locale, zone);
            const isSelected = selected?.iso === iso;
            const inner = (
              <>
                <span className="text-xs uppercase">{chip.weekday}</span>
                <span className="text-base font-medium">{chip.day}</span>
                <span className="h-4 text-xs">{i === 0 || day.day === 1 ? chip.month : ""}</span>
              </>
            );
            const chipClass =
              "flex min-h-16 flex-col items-center justify-center rounded-lg border px-1 py-1";
            return (
              <li key={iso}>
                {slots.length > 0 ? (
                  <Link
                    href={bookingHref({ ...base, from: startIso, date: iso })}
                    aria-current={isSelected ? "date" : undefined}
                    className={cn(
                      chipClass,
                      "outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "hover:bg-muted",
                    )}
                  >
                    {inner}
                  </Link>
                ) : (
                  <span className={cn(chipClass, "opacity-40")} aria-disabled="true">
                    {inner}
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        <div className="mt-2 flex items-center justify-between">
          {prevStart ? (
            <Link href={weekHref(prevStart)} className={navClass}>
              <ChevronLeft className="size-4" aria-hidden="true" />
              {t("prevWeek")}
            </Link>
          ) : (
            <span />
          )}
          {nextStart ? (
            <Link href={weekHref(nextStart)} className={navClass}>
              {t("nextWeek")}
              <ChevronRight className="size-4" aria-hidden="true" />
            </Link>
          ) : (
            <span />
          )}
        </div>
      </section>

      <section aria-live="polite">
        {selected ? (
          <>
            <h3 className="mb-3 font-medium">
              {t("timesFor", { day: formatDayLong(selected.day.toJSDate(), locale, zone) })}
            </h3>
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {selected.slots.map((slot) => (
                <li key={slot.getTime()}>
                  <Link
                    href={bookingHref({
                      ...base,
                      from: startIso,
                      date: selected.iso,
                      at: slot.toISOString(),
                    })}
                    className="flex min-h-11 items-center justify-center rounded-lg border px-3 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {formatTime(slot, locale, zone)}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-muted-foreground">{t("noSlotsWeek")}</p>
        )}
      </section>
    </div>
  );
}

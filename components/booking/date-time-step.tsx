import type { ReactNode } from "react";
import { DateTime } from "luxon";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { BookingForm } from "@/components/booking/booking-form";
import { MonthCalendar } from "@/components/booking/month-calendar";
import { Chosen, Heading, bookingHref } from "@/components/booking/step-ui";
import { getAvailabilityForRange } from "@/lib/availability-range";
import type { ServiceAvailability } from "@/lib/availability-service";
import type { Flow } from "@/lib/booking-flow";
import { addMonths, firstWeekdayOf, monthOfDay } from "@/lib/calendar";
import type { CatalogService } from "@/lib/catalog";
import { formatDateTime, formatDayLong, formatPrice, formatTime } from "@/lib/format";
import { toAvailabilityOptions, type SalonConfig } from "@/lib/salon-config";

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

// Un día como fecha "de calendario": a mediodía UTC para que ninguna zona horaria lo mueva de día
const noon = (day: string) => new Date(`${day}T12:00:00Z`);

// Pasos 4 y 5: primero se elige el día (calendario) y la hora; con la hora elegida, se piden los datos
export async function DateTimeStep({
  locale, config, now, flow, location, service, member, summary,
}: Props) {
  const t = await getTranslations("Booking");
  const zone = config.timezone;
  const opts = toAvailabilityOptions(config);

  // Primer y último día en los que se puede reservar (fecha local del salón)
  const todayDt = DateTime.fromJSDate(now, { zone }).startOf("day");
  const today = todayDt.toFormat(DAY_FORMAT);
  const last = todayDt.plus({ days: config.booking.maxDaysAhead }).toFormat(DAY_FORMAT);

  // Los huecos de TODO el rango reservable, con unas 6 consultas en total (ver availability-range.ts).
  // Así el calendario puede marcar qué días tienen huecos y cambiar de mes sin más cálculo.
  const availability = await getAvailabilityForRange(location.id, service.id, today, last, opts, now);

  // Huecos de cada día para la profesional elegida (o de cualquiera, juntando a todas)
  const slotsOf = (a: ServiceAvailability): Date[] =>
    member === "any"
      ? a.any.map((s) => s.startsAt)
      : (a.perStaff.find((s) => s.staffId === member.id)?.slots ?? []);

  const slotsByDay = new Map<string, Date[]>();
  for (const [day, a] of availability) {
    const slots = slotsOf(a);
    if (slots.length > 0) slotsByDay.set(day, slots);
  }
  const daysWithSlots = [...slotsByDay.keys()].sort();
  const firstDay = daysWithSlots[0] ?? null; // el próximo día con huecos

  const base: Flow = {
    location: location.id,
    service: service.id,
    staff: member === "any" ? "any" : member.id,
  };

  // ---- Paso 5: con la hora elegida (y comprobando que sigue libre) ----
  if (flow.at) {
    const at = new Date(flow.at);
    const atDay = DateTime.fromJSDate(at, { zone }).toFormat(DAY_FORMAT);
    const stillFree = (slotsByDay.get(atDay) ?? []).some((s) => s.getTime() === at.getTime());

    if (stillFree) {
      const changeHref = bookingHref({ ...base, month: monthOfDay(atDay), date: atDay }, "times");
      return (
        <div className="space-y-6">
          <div className="space-y-2">
            {summary}
            <Chosen
              key="when"
              label={formatDateTime(at, locale, zone)}
              changeHref={changeHref}
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
              backHref={changeHref}
            />
          </section>
        </div>
      );
    }
    // Si el hueco ya no existe (alguien lo reservó, o la URL está manipulada), se vuelve a elegir
  }

  // ---- Paso 4: calendario y horas ----
  const firstMonth = monthOfDay(today);
  const lastMonth = monthOfDay(last);

  // Mes que se muestra: el de la URL; si no, el del día elegido; si no, el del primer día con huecos
  const wanted =
    flow.month ?? (flow.date ? monthOfDay(flow.date) : firstDay ? monthOfDay(firstDay) : firstMonth);
  const month = wanted < firstMonth ? firstMonth : wanted > lastMonth ? lastMonth : wanted;

  // Día elegido: el de la URL si tiene huecos y es de este mes; si no, el primero de este mes con huecos
  const inMonth = daysWithSlots.filter((d) => monthOfDay(d) === month);
  const selected =
    flow.date && slotsByDay.has(flow.date) && monthOfDay(flow.date) === month
      ? flow.date
      : (inMonth[0] ?? null);

  const dayLabel = (day: string) => formatDayLong(noon(day), locale, "UTC");

  return (
    <div className="space-y-6">
      <div className="space-y-2">{summary}</div>

      <section>
        <Heading>{t("stepDate")}</Heading>

        <MonthCalendar
          locale={locale}
          month={month}
          // El calendario sigue las costumbres del idioma por defecto del salón (es: lunes primero)
          firstWeekday={firstWeekdayOf(config.defaultLocale)}
          today={today}
          last={last}
          daysWithSlots={new Set(daysWithSlots)}
          selected={selected}
          dayHref={(day) => bookingHref({ ...base, month, date: day }, "times")}
          prevHref={month > firstMonth ? bookingHref({ ...base, month: addMonths(month, -1) }) : null}
          nextHref={month < lastMonth ? bookingHref({ ...base, month: addMonths(month, 1) }) : null}
          labels={{
            calendar: t("calendarLabel"),
            prev: t("prevMonth"),
            next: t("nextMonth"),
            unavailable: t("dayUnavailable"),
          }}
        />

        {firstDay && selected !== firstDay && (
          <Link
            href={bookingHref({ ...base, month: monthOfDay(firstDay), date: firstDay }, "times")}
            className="mt-2 inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4"
          >
            {t("nextAvailable", { day: dayLabel(firstDay) })}
          </Link>
        )}
      </section>

      <section id="times" aria-live="polite" className="scroll-mt-4">
        {selected ? (
          <>
            <h3 className="mb-3 font-medium">{t("timesFor", { day: dayLabel(selected) })}</h3>
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {(slotsByDay.get(selected) ?? []).map((slot) => (
                <li key={slot.getTime()}>
                  <Link
                    href={bookingHref({ ...base, month, date: selected, at: slot.toISOString() })}
                    className="flex min-h-11 items-center justify-center rounded-lg border px-3 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {formatTime(slot, locale, zone)}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-muted-foreground">
            {firstDay ? t("noSlotsMonth") : t("noSlotsAtAll")}
          </p>
        )}
      </section>
    </div>
  );
}
import { DateTime } from "luxon";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { BookingForm } from "@/components/booking/booking-form";
import {
  BookingShell, PickedRows, YourAppointment,
  type PickedSummary, type StepNames, type SummaryLabels,
} from "@/components/booking/booking-shell";
import { MonthCalendar } from "@/components/booking/month-calendar";
import { Heading, bookingHref } from "@/components/booking/step-ui";
import type { ServiceAvailability } from "@/lib/availability-service";
import type { Flow } from "@/lib/booking-flow";
import { addMonths, firstWeekdayOf, monthOfDay } from "@/lib/calendar";
import { collectorForStaff } from "@/lib/collectors-db";
import type { CatalogService } from "@/lib/catalog";
import { depositForServices } from "@/lib/deposit";
import { formatDateTime, formatDayLong, formatDuration, formatPrice, formatTime } from "@/lib/format";
import { needsWhatsAppTab } from "@/lib/whatsapp-tab";
import { KoiboxUnavailableError, confirmBookingSlot, getBookingAvailability } from "@/lib/availability-source";
import type { SalonConfig } from "@/lib/salon-config";
import { buildWhatsAppLink } from "@/lib/whatsapp-link";

const DAY_FORMAT = "yyyy-MM-dd";

type Props = {
  locale: string;
  config: SalonConfig;
  now: Date;
  flow: Flow;
  location: { id: number; name: string };
  services: CatalogService[]; // uno o varios, en el orden en que se hacen
  member: "any" | { id: number; name: string };
  // Lo elegido hasta ahora (local, servicios, profesional) y los textos para pintarlo
  summary: PickedSummary;
  labels: SummaryLabels;
  names: StepNames;
};

// Un día como fecha "de calendario": a mediodía UTC para que ninguna zona horaria lo mueva de día
const noon = (day: string) => new Date(`${day}T12:00:00Z`);

// Pasos 4 y 5: primero se elige el día (calendario) y la hora; con la hora elegida, se piden los datos
export async function DateTimeStep({
  locale, config, now, flow, location, services, member, summary, labels, names,
}: Props) {
  const t = await getTranslations("Booking");
  const zone = config.timezone;

  const ids = services.map((s) => s.id);
  const totalMin = services.reduce((sum, s) => sum + s.durationMin, 0);
  // Un depósito por categoría (los de cejas, uno; cejas + pestañas, se suman)
  const depositCents = depositForServices(services);

  // El marco del paso 3 (calendario): filas arriba y «Tu cita» en el ordenador
  const dateShell = (children: React.ReactNode) => (
    <BookingShell
      step={3}
      names={names}
      picked={<PickedRows summary={summary} labels={labels} />}
      aside={<YourAppointment summary={summary} labels={labels} />}
    >
      {children}
    </BookingShell>
  );

  // Primer y último día en los que se puede reservar (fecha local del salón)
  const todayDt = DateTime.fromJSDate(now, { zone }).startOf("day");
  const today = todayDt.toFormat(DAY_FORMAT);
  const last = todayDt.plus({ days: config.booking.maxDaysAhead }).toFormat(DAY_FORMAT);

  // Si Koibox no responde, no se enseñan horas (podrían estar ya ocupadas): aviso y WhatsApp
  const agendaUnavailable = dateShell(
    <section className="space-y-3 rounded-lg border bg-muted/50 p-4" role="status">
      <p>{t("agendaUnavailable")}</p>
      {config.contact.whatsapp ? (
        <a
          href={buildWhatsAppLink(config.contact.whatsapp)}
          className="inline-flex min-h-11 items-center font-medium underline underline-offset-4"
        >
          {t("agendaUnavailableWhatsApp")}
        </a>
      ) : null}
    </section>,
  );

  // Los huecos de TODO el rango reservable de una vez: en modo local con unas 6 consultas
  // (availability-range.ts); en modo Koibox con los datos de cada cuenta, en caché 2 minutos.
  // Así el calendario puede marcar qué días tienen huecos y cambiar de mes sin más cálculo.
  // Con varios servicios, la cita dura la suma y solo cuentan las profesionales que los hacen todos.
  let availability: Map<string, ServiceAvailability>;
  try {
    availability = await getBookingAvailability(config, location.id, ids, today, last, now);
  } catch (error) {
    if (!(error instanceof KoiboxUnavailableError)) throw error;
    console.error(error);
    return agendaUnavailable;
  }

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
    services: ids,
    staff: member === "any" ? "any" : member.id,
  };

  // ---- Paso 5: con la hora elegida (y comprobando que sigue libre) ----
  if (flow.at) {
    const at = new Date(flow.at);
    const atDay = DateTime.fromJSDate(at, { zone }).toFormat(DAY_FORMAT);
    let stillFree = (slotsByDay.get(atDay) ?? []).some((s) => s.getTime() === at.getTime());
    // Quién la atenderá: la elegida o, con "cualquiera", la primera libre a esa hora (como al reservar)
    let expectedStaff: number | null =
      member === "any"
        ? (availability.get(atDay)?.any.find((s) => s.startsAt.getTime() === at.getTime())?.staffIds[0] ?? null)
        : member.id;

    // En modo Koibox, antes de pedir los datos se confirma con Koibox sin caché
    if (stillFree && config.booking.availability === "koibox") {
      try {
        const staffChoice = member === "any" ? "any" : member.id;
        expectedStaff = await confirmBookingSlot(config, location.id, ids, staffChoice, at, now);
        stillFree = expectedStaff !== null;
      } catch (error) {
        if (!(error instanceof KoiboxUnavailableError)) throw error;
        console.error(error);
        return agendaUnavailable;
      }
    }

    if (stillFree && expectedStaff !== null) {
      const changeHref = bookingHref({ ...base, month: monthOfDay(atDay), date: atDay }, "times");
      // Si el depósito se pide por WhatsApp, el formulario abre la pestaña al enviar: depende de
      // quién cobra a esa profesional (docs/collectors.md)
      const collector = await collectorForStaff(expectedStaff, config);
      const depositAmount = depositCents ? formatPrice(depositCents, locale, config.currency) : null;
      // Con tarjeta se paga el depósito al reservar; el resto, en el salón
      const byCard = depositCents !== null && collector.deposit.mode === "card";
      const totalCents = services.reduce((sum, s) => sum + s.priceCents, 0);
      const inSalon =
        byCard && depositCents !== null && totalCents > depositCents ? formatPrice(totalCents - depositCents, locale, config.currency) : null;
      const withWhen: PickedSummary = { ...summary, when: { label: formatDateTime(at, locale, zone), changeHref } };
      return (
        <BookingShell
          step={4}
          names={names}
          picked={<PickedRows summary={withWhen} labels={labels} />}
          aside={<YourAppointment summary={withWhen} labels={labels} />}
        >
          <section>
            <Heading>{t("stepDetails")}</Heading>
            <BookingForm
              depositNotice={
                depositAmount
                  ? byCard
                    ? t("depositNoticeCard", { amount: depositAmount })
                    : t("depositNotice", { amount: depositAmount, hours: config.booking.deposit.holdHours })
                  : null
              }
              card={byCard ? { minutes: config.booking.deposit.cardHoldMinutes, inSalon } : null}
              savedHours={config.booking.deposit.saved ? config.booking.cancellationNoticeHours : null}
              saved={
                byCard && config.booking.deposit.saved
                  ? {
                      staffId: expectedStaff,
                      zone,
                      total: formatPrice(totalCents, locale, config.currency),
                      free: formatPrice(0, locale, config.currency),
                    }
                  : null
              }
              locale={locale}
              locationId={location.id}
              serviceIds={ids}
              staff={member === "any" ? "any" : String(member.id)}
              at={flow.at}
              backHref={changeHref}
              opensWhatsApp={needsWhatsAppTab({
                mode: collector.deposit.mode,
                whatsapp: collector.deposit.whatsapp,
                depositCents,
              })}
              depositAmount={depositAmount}
            />
          </section>
        </BookingShell>
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
  // En la franja, «hoy» y «mañana» como en las tarjetas de profesional
  const tomorrow = todayDt.plus({ days: 1 }).toFormat(DAY_FORMAT);
  const nearDayLabel = (day: string) =>
    day === today ? t("today") : day === tomorrow ? t("tomorrow") : dayLabel(day);

  return dateShell(
    <section>
      <Heading>{t("stepDate")}</Heading>

      {/* El próximo hueco, en su franja (si el día elegido no es ya ese) */}
      {firstDay && selected !== firstDay && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg bg-muted px-4 py-2.5 text-sm">
          <span>{t("nextAvailable", { day: nearDayLabel(firstDay) })}</span>
          <Link
            href={bookingHref({ ...base, month: monthOfDay(firstDay), date: firstDay }, "times")}
            className="inline-flex min-h-11 shrink-0 items-center font-medium underline underline-offset-4"
          >
            {t("goToDay")}
          </Link>
        </div>
      )}

      {/* En el ordenador, el calendario a la izquierda y las horas a la derecha */}
      <div className="space-y-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6 lg:space-y-0">
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
            legend: t("calendarLegend"),
          }}
        />

        <div id="times" aria-live="polite" className="scroll-mt-4">
          {selected ? (
            <>
              <h3 className="mb-3 font-medium">{t("timesFor", { day: dayLabel(selected) })}</h3>
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-3">
                {(slotsByDay.get(selected) ?? []).map((slot) => (
                  <li key={slot.getTime()}>
                    <Link
                      href={bookingHref({ ...base, month, date: selected, at: slot.toISOString() })}
                      className="flex min-h-11 items-center justify-center rounded-lg border bg-card px-3 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {formatTime(slot, locale, zone)}
                    </Link>
                  </li>
                ))}
              </ul>
              {services.length > 1 && (
                <p className="mt-3 text-sm text-muted-foreground">
                  {t("timesFitAll", { duration: formatDuration(totalMin) })}
                </p>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">
              {firstDay ? t("noSlotsMonth") : t("noSlotsAtAll")}
            </p>
          )}
        </div>
      </div>
    </section>,
  );
}
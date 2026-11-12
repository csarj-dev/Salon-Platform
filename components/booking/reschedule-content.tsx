import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { io } from "next/cache";
import { DateTime } from "luxon";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { MonthCalendar } from "@/components/booking/month-calendar";
import { RescheduleConfirm } from "@/components/booking/reschedule-confirm";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { buttonVariants } from "@/components/ui/button";
import { getChangeTarget } from "@/lib/appointment-view";
import { KoiboxUnavailableError, getBookingAvailability } from "@/lib/availability-source";
import { addMonths, firstWeekdayOf, isMonthKey, monthOfDay } from "@/lib/calendar";
import { clientChangeState } from "@/lib/client-changes";
import { formatDateTime, formatDayLong, formatTime } from "@/lib/format";
import { loadSalonConfig } from "@/lib/salon-config";
import { buildWhatsAppLink } from "@/lib/whatsapp-link";
import { cn } from "@/lib/utils";

type Props = {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const DAY_FORMAT = "yyyy-MM-dd";
const DAY = /^\d{4}-\d{2}-\d{2}$/;
// Un día como fecha "de calendario": a mediodía UTC para que ninguna zona horaria lo mueva de día
const noon = (day: string) => new Date(`${day}T12:00:00Z`);
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// Cambiar una cita de día u hora: misma profesional, servicio y local. Se llega desde la página
// de la cita (enlace del correo). Primero día y hora; con la hora elegida, se confirma.
export async function RescheduleContent({ params, searchParams }: Props) {
  const { locale, token } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const [config, t, tb, raw] = await Promise.all([
    loadSalonConfig(),
    getTranslations({ locale, namespace: "Reschedule" }),
    getTranslations({ locale, namespace: "Booking" }),
    searchParams,
  ]);
  if (!config.booking.channels.includes("online")) notFound();

  // La hora actual cambia en cada visita: se excluye del prerenderizado con io() antes de leerla
  await io();
  const now = new Date();
  const target = await getChangeTarget(token, locale, config.defaultLocale);
  if (!target) notFound();

  const zone = config.timezone;
  const appointmentHref = `/booking/confirmed/${token}`;
  const changeHref = (q: { month?: string; date?: string; at?: string }, hash?: string) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v) sp.set(k, v);
    const query = sp.toString();
    return `${appointmentHref}/change${query ? `?${query}` : ""}${hash ? `#${hash}` : ""}`;
  };
  const contactHref = config.contact.whatsapp ? buildWhatsAppLink(config.contact.whatsapp) : null;

  const page = (body: ReactNode) => (
    <div className="mx-auto max-w-xl space-y-6 px-6 py-8">
      <div>
        <Link href={appointmentHref} className="text-sm text-muted-foreground">
          ← {t("back")}
        </Link>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">{t("title")}</h1>
      </div>
      <section className="rounded-lg border p-4 text-sm">
        <h2 className="font-medium">{t("current")}</h2>
        <p className="mt-1">
          {target.serviceName} · {t("with", { staff: target.staffName })}
        </p>
        <p className="text-muted-foreground">{formatDateTime(target.startsAt, locale, zone)}</p>
        <p className="mt-2 text-muted-foreground">{t("sameStaff")}</p>
      </section>
      {body}
    </div>
  );

  // ¿Se puede cambiar desde aquí? (mismas reglas que moveAppointment)
  const changes = clientChangeState(target, config, now);
  if (changes.reschedule !== "allowed") {
    return page(
      <section className="space-y-3">
        <p>
          {changes.reschedule === "too_late"
            ? t("tooLate", { hours: config.booking.cancellationNoticeHours })
            : t("notAllowed")}
        </p>
        {contactHref && (
          <WhatsAppButton href={contactHref} variant="outline">
            {t("contact")}
          </WhatsAppButton>
        )}
      </section>,
    );
  }

  // Huecos de todo el rango reservable, sin contar la propia cita (puede pisar su hora actual)
  const todayDt = DateTime.fromJSDate(now, { zone }).startOf("day");
  const today = todayDt.toFormat(DAY_FORMAT);
  const last = todayDt.plus({ days: config.booking.maxDaysAhead }).toFormat(DAY_FORMAT);
  let slotsByDay: Map<string, Date[]>;
  try {
    const availability = await getBookingAvailability(config, target.locationId, target.serviceId, today, last, now, {
      appointmentId: target.id,
      staffId: target.staffId,
      startsAt: target.startsAt,
      endsAt: target.endsAt,
    });
    slotsByDay = new Map();
    for (const [day, a] of availability) {
      // Solo su profesional, y sin su hora actual (no es un cambio)
      const slots = (a.perStaff.find((s) => s.staffId === target.staffId)?.slots ?? []).filter(
        (s) => s.getTime() !== target.startsAt.getTime(),
      );
      if (slots.length > 0) slotsByDay.set(day, slots);
    }
  } catch (error) {
    if (!(error instanceof KoiboxUnavailableError)) throw error;
    console.error(error);
    // Si Koibox no responde, no se enseñan horas (podrían estar ya ocupadas)
    return page(
      <section className="space-y-3 rounded-lg border bg-muted/50 p-4" role="status">
        <p>{tb("agendaUnavailable")}</p>
        {contactHref && (
          <a href={contactHref} className="inline-flex min-h-11 items-center font-medium underline underline-offset-4">
            {tb("agendaUnavailableWhatsApp")}
          </a>
        )}
      </section>,
    );
  }

  const daysWithSlots = [...slotsByDay.keys()].sort();
  const firstDay = daysWithSlots[0] ?? null;
  const dayLabel = (day: string) => formatDayLong(noon(day), locale, "UTC");

  // ---- Con la hora elegida: confirmar ----
  const atRaw = first(raw.at);
  if (atRaw) {
    const at = new Date(atRaw);
    if (!Number.isNaN(at.getTime())) {
      const atDay = DateTime.fromJSDate(at, { zone }).toFormat(DAY_FORMAT);
      const free = (slotsByDay.get(atDay) ?? []).some((s) => s.getTime() === at.getTime());
      if (free) {
        return page(
          <section className="space-y-4">
            <div className="rounded-lg border bg-muted/50 p-4">
              <h2 className="text-sm font-medium">{t("newTitle")}</h2>
              <p className="mt-1 text-lg font-semibold">{formatDateTime(at, locale, zone)}</p>
              <p className="mt-2 text-sm text-muted-foreground">{t("confirmHelp")}</p>
            </div>
            <RescheduleConfirm
              token={token}
              at={at.toISOString()}
              chooseOtherHref={changeHref({ month: monthOfDay(atDay), date: atDay }, "times")}
              doneHref={appointmentHref}
            />
          </section>,
        );
      }
    }
    // Si esa hora ya no está libre (o la URL está mal), se vuelve a elegir
  }

  // ---- Calendario y horas ----
  const firstMonth = monthOfDay(today);
  const lastMonth = monthOfDay(last);
  const monthRaw = first(raw.month);
  const dateRaw = first(raw.date);
  const date = dateRaw && DAY.test(dateRaw) ? dateRaw : undefined;
  const wanted =
    monthRaw && isMonthKey(monthRaw)
      ? monthRaw
      : date
        ? monthOfDay(date)
        : firstDay
          ? monthOfDay(firstDay)
          : firstMonth;
  const month = wanted < firstMonth ? firstMonth : wanted > lastMonth ? lastMonth : wanted;
  const inMonth = daysWithSlots.filter((d) => monthOfDay(d) === month);
  const selected =
    date && slotsByDay.has(date) && monthOfDay(date) === month ? date : (inMonth[0] ?? null);

  return page(
    <>
      <section>
        <h2 className="mb-3 text-lg font-medium">{tb("stepDate")}</h2>
        <MonthCalendar
          locale={locale}
          month={month}
          firstWeekday={firstWeekdayOf(config.defaultLocale)}
          today={today}
          last={last}
          daysWithSlots={new Set(daysWithSlots)}
          selected={selected}
          dayHref={(day) => changeHref({ month, date: day }, "times")}
          prevHref={month > firstMonth ? changeHref({ month: addMonths(month, -1) }) : null}
          nextHref={month < lastMonth ? changeHref({ month: addMonths(month, 1) }) : null}
          labels={{
            calendar: tb("calendarLabel"),
            prev: tb("prevMonth"),
            next: tb("nextMonth"),
            unavailable: tb("dayUnavailable"),
          }}
        />
        {firstDay && selected !== firstDay && (
          <Link
            href={changeHref({ month: monthOfDay(firstDay), date: firstDay }, "times")}
            className="mt-2 inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4"
          >
            {tb("nextAvailable", { day: dayLabel(firstDay) })}
          </Link>
        )}
      </section>

      <section id="times" aria-live="polite" className="scroll-mt-4">
        {selected ? (
          <>
            <h3 className="mb-3 font-medium">{tb("timesFor", { day: dayLabel(selected) })}</h3>
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {(slotsByDay.get(selected) ?? []).map((slot) => (
                <li key={slot.getTime()}>
                  <Link
                    href={changeHref({ month, date: selected, at: slot.toISOString() })}
                    className="flex min-h-11 items-center justify-center rounded-lg border px-3 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {formatTime(slot, locale, zone)}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-muted-foreground">{firstDay ? tb("noSlotsMonth") : tb("noSlotsAtAll")}</p>
        )}
      </section>

      <Link href={appointmentHref} className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "h-11 px-5")}>
        {t("back")}
      </Link>
    </>,
  );
}
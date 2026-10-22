import { ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { BookingHref } from "@/components/booking/step-ui";
import { monthGrid, referenceDateForWeekday, weekdayOrder } from "@/lib/calendar";
import { formatDayLong } from "@/lib/format";
import { cn } from "@/lib/utils";

type Props = {
  locale: string;
  month: string; // "2026-11"
  firstWeekday: number; // 1 = lunes ... 7 = domingo
  today: string; // "2026-11-02": el primer día que se puede reservar
  last: string; // el último día que se puede reservar
  daysWithSlots: ReadonlySet<string>;
  selected: string | null;
  dayHref: (day: string) => BookingHref;
  prevHref: BookingHref | null;
  nextHref: BookingHref | null;
  labels: { calendar: string; prev: string; next: string; unavailable: string };
};

const navClass =
  "inline-flex size-11 items-center justify-center rounded-lg outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring";

// Un día como fecha "de calendario": a mediodía UTC para que ninguna zona horaria lo mueva de día
const noon = (day: string) => new Date(`${day}T12:00:00Z`);

export function MonthCalendar({
  locale, month, firstWeekday, today, last, daysWithSlots, selected,
  dayHref, prevHref, nextHref, labels,
}: Props) {
  const [year, mon] = month.split("-").map(Number);
  const title = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, mon - 1, 1)));

  const weekdays = weekdayOrder(firstWeekday).map((w) => {
    const date = referenceDateForWeekday(w);
    return {
      key: w,
      short: new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(date),
      long: new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(date),
    };
  });

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        {prevHref ? (
          <Link href={prevHref} aria-label={labels.prev} className={navClass}>
            <ChevronLeft className="size-5" aria-hidden="true" />
          </Link>
        ) : (
          <span className="size-11" aria-hidden="true" />
        )}
        <h3 className="font-medium capitalize" aria-live="polite">
          {title}
        </h3>
        {nextHref ? (
          <Link href={nextHref} aria-label={labels.next} className={navClass}>
            <ChevronRight className="size-5" aria-hidden="true" />
          </Link>
        ) : (
          <span className="size-11" aria-hidden="true" />
        )}
      </div>

      <table className="w-full table-fixed border-separate border-spacing-y-1" aria-label={labels.calendar}>
        <thead>
          <tr>
            {weekdays.map((w) => (
              <th key={w.key} scope="col" abbr={w.long} className="pb-1 text-xs font-normal uppercase text-muted-foreground">
                {w.short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthGrid(month, firstWeekday).map((week, i) => (
            <tr key={i}>
              {week.map((day, j) => {
                if (day === null) return <td key={j} />;

                const number = Number(day.slice(8));
                const bookable = day >= today && day <= last;
                const hasSlots = bookable && daysWithSlots.has(day);
                const isSelected = selected === day;
                const long = formatDayLong(noon(day), locale, "UTC");
                const cell = cn(
                  "mx-auto flex h-11 w-full max-w-11 items-center justify-center rounded-lg text-sm",
                  day === today && "border",
                );

                return (
                  <td key={day} className="p-0.5 text-center">
                    {hasSlots ? (
                      <Link
                        href={dayHref(day)}
                        aria-label={long}
                        aria-current={isSelected ? "date" : undefined}
                        className={cn(
                          cell,
                          "font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          isSelected
                            ? "bg-primary text-primary-foreground"
                            : "hover:bg-muted",
                        )}
                      >
                        {number}
                      </Link>
                    ) : (
                      <span
                        aria-disabled="true"
                        aria-label={`${long}, ${labels.unavailable}`}
                        className={cn(cell, "text-muted-foreground/40")}
                      >
                        {number}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
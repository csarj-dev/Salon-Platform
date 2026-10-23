import { io } from "next/cache";
import { DateTime } from "luxon";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppointmentCard } from "@/components/admin/appointment-card";
import { Link } from "@/i18n/navigation";
import { listAppointments, type AppointmentStatus } from "@/lib/appointment-list";
import { formatDayLong } from "@/lib/format";
import { groupByDay } from "@/lib/group-by-day";
import { can } from "@/lib/permissions";
import { loadSalonConfig } from "@/lib/salon-config";
import { requireStaff } from "@/lib/session";
import { cn } from "@/lib/utils";
import { latestEmailByAppointment } from "@/lib/email/email-status";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string }>;
};

const TABS = ["upcoming", "past", "cancelled"] as const;
type Tab = (typeof TABS)[number];

const isTab = (v: string | undefined): v is Tab => TABS.some((t) => t === v);

export default async function AppointmentsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { role } = await requireStaff(locale, "appointments.view");
  const { tab: rawTab } = await searchParams;
  const tab: Tab = isTab(rawTab) ? rawTab : "upcoming";

  const [config, t] = await Promise.all([
    loadSalonConfig(),
    getTranslations({ locale, namespace: "Admin.appointments" }),
  ]);

  // La hora actual cambia en cada visita: se excluye del prerenderizado con io() antes de leerla
  await io();
  const now = new Date();
  const nowMs = now.getTime();
  // "Hoy" y los 30 días anteriores se cuentan en la zona del salón
  const startOfToday = DateTime.fromJSDate(now, { zone: config.timezone }).startOf("day");
  const thirtyDaysAgo = startOfToday.minus({ days: 30 });

  const query: Record<Tab, Parameters<typeof listAppointments>[0]> = {
    upcoming: {
      statuses: ["booked", "pending_deposit"] satisfies AppointmentStatus[],
      from: startOfToday.toJSDate(),
      order: "asc",
    },
    past: {
      statuses: ["booked", "completed", "no_show"] satisfies AppointmentStatus[],
      from: thirtyDaysAgo.toJSDate(),
      to: startOfToday.toJSDate(),
      order: "desc",
    },
    cancelled: {
      statuses: ["cancelled", "expired"] satisfies AppointmentStatus[],
      from: thirtyDaysAgo.toJSDate(),
      order: "desc",
    },
  };

  const rows = await listAppointments(query[tab]);
  const emails = await latestEmailByAppointment(rows.map((r) => r.id));
  const groups = groupByDay(
    rows.map((r) => ({ ...r, email: emails.get(r.id) ?? null })),
    config.timezone,
  );

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>

      <nav aria-label={t("tabsLabel")} className="flex flex-wrap gap-2">
        {TABS.map((id) => (
          <Link
            key={id}
            href={`/admin/appointments?tab=${id}`}
            aria-current={id === tab ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              id === tab ? "bg-primary text-primary-foreground" : "hover:bg-muted",
            )}
          >
            {t(`tabs.${id}`)}
          </Link>
        ))}
      </nav>

      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(`empty.${tab}`)}</p>
      ) : (
        groups.map((group) => (
          <div key={group.day} className="space-y-3">
            <h2 className="text-sm font-semibold capitalize text-muted-foreground">
              {formatDayLong(group.date, locale, config.timezone)}
            </h2>
            <ul className="space-y-3">
              {group.rows.map((row) => (
                <AppointmentCard
                  key={row.id}
                  data={row}
                  locale={locale}
                  zone={config.timezone}
                  currency={config.currency}
                  salonName={config.name}
                  phoneCountryCode={config.phoneCountryCode}
                  now={nowMs}
                  timeOnly
                  actionable={tab === "upcoming"}
                  canValidate={can(role, "deposits.manage")}
                  canCancel={can(role, "appointments.manage")}
                  canResend={can(role, "appointments.manage")}
                />
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
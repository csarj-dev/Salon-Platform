import { Suspense } from "react";
import { io } from "next/cache";
import { DateTime } from "luxon";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CancelButton } from "@/components/admin/cancel-button";
import { Dot, PageHeader, SectionLabel, textAction } from "@/components/admin/panel-ui";
import { PanelSkeleton } from "@/components/admin/panel-skeleton";
import { ValidateButton } from "@/components/admin/validate-button";
import { Link } from "@/i18n/navigation";
import { hasSeveralCollectors, resolveCollector } from "@/lib/collectors";
import {
  depositsValidatedSince,
  expireOverdueDeposits,
  listDeposits,
  type DepositRow,
} from "@/lib/deposit-db";
import { formatDateTime, formatPrice, formatTime, timeLeftParts } from "@/lib/format";
import { can } from "@/lib/permissions";
import { loadSalonConfig } from "@/lib/salon-config";
import { requireStaff } from "@/lib/session";
import { cn } from "@/lib/utils";
import { buildWhatsAppLink, toWhatsAppNumber } from "@/lib/whatsapp-link";

type Props = { params: Promise<{ locale: string }> };

export default async function DepositsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Admin.deposits" });

  return (
    <section className="space-y-6">
      <PageHeader title={t("title")} description={t("intro")} />
      <Suspense fallback={<PanelSkeleton />}>
        <DepositsContent locale={locale} />
      </Suspense>
    </section>
  );
}

type GroupKey = "soon" | "today" | "later";

// Franja de cada grupo y color de la cuenta atrás (colores del tema del salón)
const GROUP_HEAD: Record<GroupKey, string> = {
  soon: "border-danger bg-danger/10",
  today: "border-warning bg-warning/12",
  later: "border-border bg-background",
};
const LEFT_TONE: Record<GroupKey, string> = {
  soon: "font-semibold text-danger",
  today: "font-semibold text-warning",
  later: "font-semibold",
};

const SOON_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;

async function DepositsContent({ locale }: { locale: string }) {
  const { role } = await requireStaff(locale, "deposits.manage");
  // Antes de listar, se liberan las que ya vencieron para que no salgan como pendientes
  await expireOverdueDeposits();

  const [config, t, tCard, tWa, pending, expired] = await Promise.all([
    loadSalonConfig(),
    getTranslations({ locale, namespace: "Admin.deposits" }),
    getTranslations({ locale, namespace: "Admin.card" }),
    getTranslations({ locale, namespace: "Admin.whatsapp" }),
    listDeposits("pending_deposit"),
    listDeposits("expired", { sinceDays: 14 }),
  ]);
  // La hora actual cambia en cada visita: se excluye del prerenderizado con io() antes de leerla
  await io();
  const now = new Date();
  const nowMs = now.getTime();
  const validated = await depositsValidatedSince(new Date(nowMs - 7 * DAY_MS));

  const zone = config.timezone;
  const money = (cents: number) => formatPrice(cents, locale, config.currency);
  const startOfToday = DateTime.fromJSDate(now, { zone }).startOf("day");
  const startOfTodayMs = startOfToday.toMillis();
  const endOfTodayMs = startOfToday.plus({ days: 1 }).toMillis();
  const soonMs = nowMs + SOON_MS;

  // Con varias titulares, cada fila dice a quién se paga (docs/collectors.md)
  const several = hasSeveralCollectors(config);
  const collectorOf = (r: DepositRow) =>
    resolveCollector(config, { staffCollector: r.staffCollector, koiboxAccount: r.staffKoiboxAccount });

  // "hoy 11:40" si es hoy; si no, el día y la hora
  const dueText = (d: Date) =>
    d.getTime() >= startOfTodayMs && d.getTime() < endOfTodayMs
      ? t("todayAt", { time: formatTime(d, locale, zone) })
      : formatDateTime(d, locale, zone);
  const leftText = (d: Date) => {
    const p = timeLeftParts(d.getTime() - nowMs);
    if (p.kind === "overdue") return t("left.overdue");
    if (p.kind === "minutes") return t("left.minutes", { minutes: p.minutes });
    if (p.kind === "hours") return t("left.hours", { hours: p.hours, minutes: p.minutes });
    return t("left.days", { days: p.days, hours: p.hours });
  };
  const whatsappHref = (r: DepositRow, key: "contactPending" | "contactExpired") =>
    buildWhatsAppLink(
      toWhatsAppNumber(r.clientPhone, config.phoneCountryCode),
      tWa(key, {
        name: r.clientName,
        salon: config.name,
        id: r.id,
        service: r.serviceName,
        when: formatDateTime(r.startsAt, locale, zone),
      }),
    );
  const clientLink = (r: DepositRow) => (
    <Link href={`/admin/appointments?client=${r.clientId}`} className="font-medium underline-offset-4 hover:underline">
      {r.clientName}
    </Link>
  );

  // Por urgencia: menos de 3 h, antes de medianoche, el resto
  const due = (r: DepositRow) => r.depositDueAt.getTime();
  const groups: { key: GroupKey; rows: DepositRow[] }[] = [
    { key: "soon", rows: pending.filter((r) => due(r) < soonMs) },
    { key: "today", rows: pending.filter((r) => due(r) >= soonMs && due(r) < endOfTodayMs) },
    { key: "later", rows: pending.filter((r) => due(r) >= soonMs && due(r) >= endOfTodayMs) },
  ];

  const canValidate = can(role, "deposits.manage");
  const canCancel = can(role, "appointments.manage");
  const totalPending = pending.reduce((sum, r) => sum + r.depositCents, 0);
  const dueSoon = groups[0].rows.length;

  const tiles = [
    { key: "pending", label: t("tiles.pending"), value: t("tiles.countAmount", { count: pending.length, amount: money(totalPending) }) },
    { key: "soon", label: t("tiles.dueSoon"), value: String(dueSoon), danger: dueSoon > 0 },
    {
      key: "validated",
      label: t("tiles.validated"),
      value: t("tiles.countAmount", { count: validated.count, amount: money(validated.cents) }),
    },
    { key: "expired", label: t("tiles.expired"), value: String(expired.length) },
  ];

  return (
    <>
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((tile) => (
          <li
            key={tile.key}
            className={cn(
              "flex flex-col gap-0.5 rounded-xl border bg-card px-3 py-2.5 sm:px-4 sm:py-3.5",
              tile.danger && "border-danger",
            )}
          >
            <span className={cn("text-sm text-muted-foreground", tile.danger && "text-danger")}>{tile.label}</span>
            <span className={cn("text-xl font-semibold sm:text-2xl", tile.danger && "text-danger")}>{tile.value}</span>
          </li>
        ))}
      </ul>

      {pending.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("pendingEmpty")}</p>
      ) : (
        groups
          .filter((g) => g.rows.length > 0)
          .map((g) => (
            <section key={g.key} className="overflow-hidden rounded-xl border bg-card">
              <div className={cn("flex flex-wrap items-baseline justify-between gap-2 border-l-4 px-4 py-3", GROUP_HEAD[g.key])}>
                <h2 className="font-semibold">{t(`groups.${g.key}`)}</h2>
                <span className="text-sm text-muted-foreground">{t(`groups.${g.key}Sub`)}</span>
              </div>
              <ul>
                {g.rows.map((r) => {
                  const c = collectorOf(r);
                  return (
                    <li key={r.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t px-4 py-3.5">
                      <div className="flex min-w-0 flex-[1_1_16rem] flex-col gap-0.5">
                        <p>
                          {clientLink(r)} <span className="text-muted-foreground">· {r.clientPhone}</span>
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {formatDateTime(r.startsAt, locale, zone)} · {r.serviceName} ·{" "}
                          {tCard("with", { staff: r.staffName })} · {tCard("reference", { id: r.id })}
                        </p>
                      </div>
                      <div className="flex w-44 flex-col gap-0.5">
                        <span className="font-semibold">{money(r.depositCents)}</span>
                        {several && (
                          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Dot color={c.color} />
                            {c.label}
                          </span>
                        )}
                      </div>
                      <div className="flex w-44 flex-col gap-0.5">
                        <span className={LEFT_TONE[g.key]}>{leftText(r.depositDueAt)}</span>
                        <span className="text-sm text-muted-foreground">{t("until", { when: dueText(r.depositDueAt) })}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <a href={whatsappHref(r, "contactPending")} target="_blank" rel="noopener noreferrer" className={textAction()}>
                          {t("askPayment")}
                        </a>
                        {canValidate && <ValidateButton appointmentId={r.id} />}
                        {canCancel && <CancelButton appointmentId={r.id} />}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
      )}

      <section className="space-y-2">
        <SectionLabel>{t("expiredTitle")}</SectionLabel>
        {expired.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("expiredEmpty")}</p>
        ) : (
          <ul className="overflow-hidden rounded-xl border bg-card">
            {expired.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b px-4 py-3 last:border-b-0">
                <span className="min-w-0 flex-[1_1_14rem]">
                  {clientLink(r)} <span className="text-muted-foreground">· {r.clientPhone}</span>
                </span>
                <span className="min-w-0 flex-[1_1_16rem] text-sm">
                  {formatDateTime(r.startsAt, locale, zone)} · {r.serviceName}
                </span>
                <span className="w-56 text-sm text-muted-foreground">
                  {t("expiredAt", { when: formatDateTime(r.depositDueAt, locale, zone) })}
                </span>
                <a href={whatsappHref(r, "contactExpired")} target="_blank" rel="noopener noreferrer" className={textAction()}>
                  {t("write")}
                </a>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-muted-foreground">{t("expiredIntro")}</p>
      </section>
    </>
  );
}
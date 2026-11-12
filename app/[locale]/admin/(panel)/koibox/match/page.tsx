import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { MatchReviewList, SaveSafeMatches, type ReviewItem } from "@/components/admin/koibox-match-actions";
import { Dot, PageHeader, Surface, textAction } from "@/components/admin/panel-ui";
import { PanelSkeleton } from "@/components/admin/panel-skeleton";
import { chooseCollector } from "@/lib/collectors";
import { planKoiboxMatches } from "@/lib/koibox-match-db";
import { matchPlanView, type MatchItem } from "@/lib/koibox-match-view";
import { koiboxApiFor, writesToKoibox } from "@/lib/koibox-sync";
import { loadSalonConfig } from "@/lib/salon-config";
import { requireStaff } from "@/lib/session";

type Props = { params: Promise<{ locale: string }> };

export default async function KoiboxMatchPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Admin.koibox" });

  return (
    <section className="space-y-6">
      <Link href="/admin/koibox" className={textAction()}>
        ← {t("backToKoibox")}
      </Link>
      <Suspense fallback={<PanelSkeleton />}>
        <MatchContent locale={locale} />
      </Suspense>
    </section>
  );
}

async function MatchContent({ locale }: { locale: string }) {
  await requireStaff(locale, "settings.manage");
  const [config, t] = await Promise.all([
    loadSalonConfig(),
    getTranslations({ locale, namespace: "Admin.koibox" }),
  ]);
  if (!writesToKoibox(config)) notFound();

  const view = matchPlanView(await planKoiboxMatches(config, koiboxApiFor(config)));

  const label = (account: string) => config.koibox.accounts[account]?.label ?? account;
  const color = (account: string) => chooseCollector(config, { koiboxAccount: account }).collector.color;
  const minutes = (m: number | null) => (m === null ? "?" : t("minutes", { count: m }));
  const theirs = (i: Pick<MatchItem, "kind" | "theirName" | "theirId" | "minutes">) =>
    i.kind === "staff"
      ? t("theirStaff", { name: i.theirName, id: i.theirId })
      : t("theirService", { name: i.theirName, id: i.theirId, minutes: minutes(i.minutes) });
  const countOf = (items: { kind: string }[], kind: "staff" | "service") => items.filter((i) => i.kind === kind).length;

  const review: ReviewItem[] = [
    ...view.review.map((i) => ({ ...i, tag: "review" as const })),
    ...view.similar.map((i) => ({ ...i, tag: "similar" as const })),
  ].map((i) => ({
    key: `${i.tag}-${i.kind}-${i.ourId}-${i.account}-${i.theirId}`,
    kind: i.kind,
    ourId: i.ourId,
    ourName: i.ourName,
    account: i.account,
    accountLabel: label(i.account),
    color: color(i.account),
    theirId: i.theirId,
    theirsText: theirs(i),
    reason: i.reason,
    tag: i.tag,
  }));

  const unmatchedServices = view.unmatched.filter((u) => u.kind === "service");
  const unmatchedStaff = view.unmatched.filter((u) => u.kind === "staff");

  const tiles = [
    {
      label: t("tiles.safe"),
      value: view.safe.length,
      sub: t("tiles.safeSub", { staff: countOf(view.safe, "staff"), services: countOf(view.safe, "service") }),
    },
    { label: t("tiles.review"), value: review.length, sub: t("tiles.reviewSub") },
    { label: t("tiles.linked"), value: view.alreadyLinked, sub: t("tiles.linkedSub") },
    {
      label: t("tiles.unmatched"),
      value: view.unmatched.length,
      sub: t("tiles.unmatchedSub", { services: unmatchedServices.length, staff: unmatchedStaff.length }),
    },
  ];

  return (
    <>
      <PageHeader
        title={t("matchTitle")}
        description={t("matchIntro")}
        action={<SaveSafeMatches count={view.safe.length} />}
      />

      {view.errors.map((e) => (
        <div key={e.account} role="alert" className="rounded-xl border-l-4 border-danger bg-danger/10 px-4 py-3 text-sm">
          <span className="font-semibold">{t("matchErrorTitle", { account: label(e.account) })}</span>{" "}
          {t("matchErrorText", { message: e.message })}
        </div>
      ))}

      <ul className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(12.5rem,1fr))]">
        {tiles.map((tile) => (
          <li key={tile.label} className="rounded-xl border bg-card p-4">
            <p className="text-sm text-muted-foreground">{tile.label}</p>
            <p className="mt-1.5 text-2xl font-semibold">{tile.value}</p>
            <p className="text-sm text-muted-foreground">{tile.sub}</p>
          </li>
        ))}
      </ul>

      <Surface className="p-5">
        <h2 className="text-lg font-semibold">{t("safeSection")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("safeHint")}</p>
        {view.safe.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t("safeEmpty")}</p>
        ) : (
          <ul className="mt-3">
            {view.safe.map((i) => (
              <li
                key={`${i.kind}-${i.ourId}-${i.account}`}
                className="flex flex-wrap items-center justify-between gap-3 border-t py-3"
              >
                <div className="flex items-center gap-3">
                  <svg
                    aria-hidden
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="size-[1.125rem] shrink-0 text-success"
                  >
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                  <div>
                    <p className="font-medium">{i.ourName}</p>
                    <p className="text-xs text-muted-foreground">{t(i.kind === "staff" ? "kindStaff" : "kindService")}</p>
                  </div>
                </div>
                <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Dot color={color(i.account)} />
                  {label(i.account)} · {theirs(i)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Surface>

      <Surface className="p-5">
        <h2 className="text-lg font-semibold">{t("reviewSection")}</h2>
        <p className="mt-1 mb-3 text-sm text-muted-foreground">{t("reviewHint")}</p>
        <MatchReviewList items={review} />
      </Surface>

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,26rem),1fr))]">
        <Surface className="p-5">
          <h2 className="text-lg font-semibold">{t("unmatchedServicesTitle", { count: unmatchedServices.length })}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("unmatchedServicesHint")}</p>
          <ul className="mt-3">
            {unmatchedServices.length === 0 ? (
              <li className="border-t py-2.5 text-sm text-muted-foreground">{t("unmatchedNone")}</li>
            ) : (
              unmatchedServices.map((u) => (
                <li key={`${u.account}-${u.theirId}`} className="flex items-center justify-between gap-3 border-t py-2.5 text-sm">
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <Dot color={color(u.account)} />
                    {u.theirName}
                  </span>
                  <span className="whitespace-nowrap text-muted-foreground">
                    {minutes(u.minutes)} · id {u.theirId}
                  </span>
                </li>
              ))
            )}
          </ul>
        </Surface>
        <Surface className="p-5">
          <h2 className="text-lg font-semibold">{t("unmatchedStaffTitle", { count: unmatchedStaff.length })}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("unmatchedStaffHint")}</p>
          <ul className="mt-3">
            {unmatchedStaff.length === 0 ? (
              <li className="border-t py-2.5 text-sm text-muted-foreground">{t("unmatchedNone")}</li>
            ) : (
              unmatchedStaff.map((u) => (
                <li key={`${u.account}-${u.theirId}`} className="flex items-center justify-between gap-3 border-t py-2.5 text-sm">
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <Dot color={color(u.account)} />
                    {u.theirName}
                  </span>
                  <span className="whitespace-nowrap text-muted-foreground">
                    {label(u.account)} · {u.theirId}
                  </span>
                </li>
              ))
            )}
          </ul>
        </Surface>
      </div>
    </>
  );
}
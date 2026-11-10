"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  applyKoiboxMatchesAction,
  planKoiboxMatchesAction,
  setServiceKoiboxLinkAction,
  setStaffKoiboxLinkAction,
} from "@/app/[locale]/admin/(panel)/koibox/actions";
import { Button } from "@/components/ui/button";
import type { MatchItem, MatchView } from "@/lib/koibox-match-view";

type Props = { accountLabels: Record<string, string> };

export function KoiboxMatchPanel({ accountLabels }: Props) {
  const t = useTranslations("Admin.koibox");
  const [view, setView] = useState<MatchView | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [busy, startBusy] = useTransition();

  const label = (account: string) => accountLabels[account] ?? account;
  const minutes = (m: number | null) => (m === null ? "?" : t("minutes", { count: m }));
  const line = (i: { kind: string; ourName?: string; theirName: string; theirId: number; minutes: number | null; account: string }) =>
    i.kind === "staff"
      ? t("staffItem", { ours: i.ourName ?? "", theirs: i.theirName, id: i.theirId, account: label(i.account) })
      : t("serviceItem", { ours: i.ourName ?? "", theirs: i.theirName, minutes: minutes(i.minutes), id: i.theirId, account: label(i.account) });

  async function search() {
    const result = await planKoiboxMatchesAction();
    if (result.ok) setView(result.view);
    else setMessage({ ok: false, text: t(`errors.${result.error}`) });
  }

  function run() {
    setMessage(null);
    setSkipped([]);
    startBusy(search);
  }

  function applySafe() {
    setMessage(null);
    startBusy(async () => {
      const result = await applyKoiboxMatchesAction();
      if (!result.ok) {
        setMessage({ ok: false, text: t(`errors.${result.error}`) });
        return;
      }
      setMessage({ ok: true, text: t("applied", { staff: result.staffLinked, services: result.servicesLinked }) });
      setSkipped(result.skipped);
      await search();
    });
  }

  function link(item: MatchItem) {
    setMessage(null);
    startBusy(async () => {
      const result =
        item.kind === "staff"
          ? await setStaffKoiboxLinkAction(item.ourId, { account: item.account, userId: item.theirId })
          : await setServiceKoiboxLinkAction(item.ourId, item.account, item.theirId);
      if (!result.ok) {
        setMessage({ ok: false, text: t(`errors.${result.error}`) });
        return;
      }
      setMessage({ ok: true, text: t("linked") });
      await search();
    });
  }

  const nothing =
    view && view.safe.length + view.review.length + view.similar.length === 0 && view.errors.length === 0;

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{t("matchTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("matchIntro")}</p>
        </div>
        <Button type="button" variant="outline" onClick={run} disabled={busy}>
          {busy ? t("matchRunning") : t("matchRun")}
        </Button>
      </div>

      {message && (
        <p role="status" className={message.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
          {message.text}
        </p>
      )}
      {skipped.length > 0 && (
        <div className="text-sm text-muted-foreground">
          <p>{t("skippedTitle")}</p>
          <ul className="list-disc pl-5">
            {skipped.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {view && (
        <div className="space-y-4">
          {view.errors.map((e) => (
            <p key={e.account} className="text-sm text-destructive">
              {t("matchError", { account: label(e.account), message: e.message })}
            </p>
          ))}

          {nothing && <p className="text-sm text-muted-foreground">{t("nothing")}</p>}

          {view.safe.length > 0 && (
            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-medium">{t("safeTitle", { count: view.safe.length })}</h3>
                  <p className="text-sm text-muted-foreground">{t("safeHint")}</p>
                </div>
                <Button type="button" onClick={applySafe} disabled={busy}>
                  {busy ? t("applying") : t("applySafe")}
                </Button>
              </div>
              <ul className="space-y-1 text-sm">
                {view.safe.map((i) => (
                  <li key={`${i.kind}-${i.ourId}-${i.account}`}>{line(i)}</li>
                ))}
              </ul>
            </section>
          )}

          {[
            { key: "review", title: t("reviewTitle"), items: view.review },
            { key: "similar", title: t("similarTitle"), items: view.similar },
          ].map(
            (group) =>
              group.items.length > 0 && (
                <section key={group.key} className="space-y-2">
                  <h3 className="font-medium">{group.title}</h3>
                  <ul className="space-y-2">
                    {group.items.map((i) => (
                      <li
                        key={`${group.key}-${i.kind}-${i.ourId}-${i.account}-${i.theirId}`}
                        className="flex flex-wrap items-center justify-between gap-2 text-sm"
                      >
                        <span className="min-w-0">
                          {line(i)}
                          {i.reason && <span className="block text-muted-foreground">{i.reason}</span>}
                        </span>
                        <Button type="button" variant="outline" size="sm" onClick={() => link(i)} disabled={busy}>
                          {t("linkThis")}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              ),
          )}

          {view.unmatched.length > 0 && (
            <section className="space-y-1">
              <h3 className="font-medium">{t("unmatchedTitle")}</h3>
              <p className="text-sm text-muted-foreground">{t("unmatchedHint")}</p>
              <ul className="list-disc pl-5 text-sm text-muted-foreground">
                {view.unmatched.map((u) => (
                  <li key={`${u.kind}-${u.account}-${u.theirId}`}>
                    {u.kind === "staff"
                      ? t("unmatchedStaff", { name: u.theirName, id: u.theirId, account: label(u.account) })
                      : t("unmatchedService", { name: u.theirName, minutes: minutes(u.minutes), id: u.theirId, account: label(u.account) })}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  applyKoiboxMatchesAction,
  setServiceKoiboxLinkAction,
  setStaffKoiboxLinkAction,
} from "@/app/[locale]/admin/(panel)/koibox/actions";
import { Button } from "@/components/ui/button";
import { Dot, StatusPill } from "./panel-ui";

type Message = { ok: boolean; text: string } | null;

/** "Guardar los N seguros". La propuesta se vuelve a calcular en el servidor al guardar. */
export function SaveSafeMatches({ count }: { count: number }) {
  const t = useTranslations("Admin.koibox");
  const [message, setMessage] = useState<Message>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  function onClick() {
    setMessage(null);
    setSkipped([]);
    startTransition(async () => {
      const r = await applyKoiboxMatchesAction();
      if (!r.ok) {
        setMessage({ ok: false, text: t(`errors.${r.error}`) });
        return;
      }
      setMessage({ ok: true, text: t("applied", { staff: r.staffLinked, services: r.servicesLinked }) });
      setSkipped(r.skipped);
    });
  }

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end sm:text-right">
      <Button type="button" className="h-11 px-4" onClick={onClick} disabled={pending || count === 0}>
        {pending ? t("applying") : t("saveSafe", { count })}
      </Button>
      {message && (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-sm text-muted-foreground" : "text-sm text-danger"}>
          {message.text}
        </p>
      )}
      {skipped.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t("skippedTitle")} {skipped.join(" · ")}
        </p>
      )}
    </div>
  );
}

export type ReviewItem = {
  key: string;
  kind: "staff" | "service";
  ourId: number;
  ourName: string;
  account: string;
  accountLabel: string;
  color: string | null;
  theirId: number;
  theirsText: string;
  reason: string | null;
  tag: "review" | "similar";
};

/** "Para revisar": cada posible pareja con "Enlazar" o "Ignorar" (ignorar solo la oculta aquí). */
export function MatchReviewList({ items }: { items: ReviewItem[] }) {
  const t = useTranslations("Admin.koibox");
  const [ignored, setIgnored] = useState<string[]>([]);
  const [message, setMessage] = useState<Message>(null);
  const [pending, startTransition] = useTransition();

  const visible = items.filter((i) => !ignored.includes(i.key));

  function link(item: ReviewItem) {
    setMessage(null);
    startTransition(async () => {
      const r =
        item.kind === "staff"
          ? await setStaffKoiboxLinkAction(item.ourId, { account: item.account, userId: item.theirId })
          : await setServiceKoiboxLinkAction(item.ourId, item.account, item.theirId);
      setMessage(r.ok ? { ok: true, text: t("linked") } : { ok: false, text: t(`errors.${r.error}`) });
    });
  }

  return (
    <div className="space-y-2">
      {message && (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-sm text-muted-foreground" : "text-sm text-danger"}>
          {message.text}
        </p>
      )}
      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("reviewEmpty")}</p>
      ) : (
        <ul>
          {visible.map((i) => (
            <li key={i.key} className="flex flex-wrap items-center justify-between gap-3 border-t py-3">
              <div className="min-w-0 flex-[1_1_28rem] space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{i.ourName}</span>
                  <StatusPill tone={i.tag === "review" ? "wait" : "neutral"}>
                    {t(i.tag === "review" ? "tagReview" : "tagSimilar")}
                  </StatusPill>
                </div>
                <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Dot color={i.color} />
                  {i.accountLabel} · {i.theirsText}
                </p>
                {i.reason && <p className="text-sm text-warning">{i.reason}</p>}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 border-foreground bg-card px-4"
                  onClick={() => link(i)}
                  disabled={pending}
                >
                  {t("linkThis")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 px-4 text-muted-foreground"
                  onClick={() => setIgnored((x) => [...x, i.key])}
                  disabled={pending}
                >
                  {t("ignore")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
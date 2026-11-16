"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { DateTime } from "luxon";
import { useTranslations } from "next-intl";
import {
  checkStaffMoveAction,
  moveStaffAppointmentAction,
  type CheckStaffMoveResult,
  type MoveStaffAppointmentResult,
} from "@/app/[locale]/admin/(panel)/appointments/actions";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { DURATION_STEP_MIN } from "@/lib/booking-catalog";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { duration } from "./agenda-ui";

// Arrastrar y estirar citas en el Día (tablero «Agenda · arrastrar y estirar citas»).
// La rejilla la pinta el servidor; cada cita lleva sus datos en data-* y cada columna su
// data-agenda-col. Aquí solo se escucha el ratón y se enseña la sombra y el diálogo.

const MIN = 60_000;
const STEP = DURATION_STEP_MIN;
const THRESHOLD_PX = 4; // menos que esto es un clic (abre la ficha)

type Block = {
  id: number;
  staffId: number;
  start: number;
  end: number;
  client: string;
  service: string;
  hasEmail: boolean;
};
type Mode = "move" | "resize";
type Ghost = {
  mode: Mode;
  staffId: number;
  start: number;
  end: number;
  clashWith: string | null;
  // Dónde está la columna en pantalla (la sombra es fija, por encima de todo)
  col: { left: number; top: number; width: number; height: number };
};
type Proposal = { block: Block; mode: Mode; to: { staffId: number; start: number; end: number } };

export type AgendaDragProps = {
  gridId: string;
  windowStart: string; // ISO: lo que está a 0 px en las columnas (1 minuto = 1 px)
  windowEnd: string;
  staff: { id: number; name: string; account: string | null }[];
  accounts: Record<string, { label: string }>;
  locale: string;
  zone: string;
};

function readBlock(el: HTMLElement): Block {
  return {
    id: Number(el.dataset.appt),
    staffId: Number(el.dataset.staff),
    start: Date.parse(el.dataset.start ?? ""),
    end: Date.parse(el.dataset.end ?? ""),
    client: el.dataset.client ?? "",
    service: el.dataset.service ?? "",
    hasEmail: el.dataset.email === "1",
  };
}

export function AgendaDrag(p: AgendaDragProps) {
  const t = useTranslations("Admin.agenda.move");
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const ws = Date.parse(p.windowStart);
  const we = Date.parse(p.windowEnd);
  const hm = (ms: number) => formatTime(new Date(ms), p.locale, p.zone);

  useEffect(() => {
    const grid = document.getElementById(p.gridId);
    if (!grid) return;

    let drag: {
      el: HTMLElement;
      block: Block;
      mode: Mode;
      x0: number;
      y0: number;
      grabOffset: number; // dónde se cogió la cita, desde su borde de arriba
      colEl: HTMLElement;
      active: boolean;
      cancelled: boolean;
      last: Ghost | null;
    } | null = null;

    const snap = (minutes: number) => Math.round(minutes / STEP) * STEP;
    const columnAt = (x: number, y: number) =>
      document
        .elementsFromPoint(x, y)
        .find((el): el is HTMLElement => el instanceof HTMLElement && el.dataset.agendaCol !== undefined) ?? null;
    const othersIn = (col: HTMLElement, selfId: number) =>
      [...col.querySelectorAll<HTMLElement>("[data-appt]")].map(readBlock).filter((b) => b.id !== selfId);
    // El clic que llega al soltar no debe abrir la ficha
    const swallow = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const swallowNextClick = () => {
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    };

    function stop() {
      if (drag?.active) {
        drag.el.style.opacity = "";
        document.body.style.userSelect = "";
      }
      drag = null;
      setGhost(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey);
    }

    function onDown(e: PointerEvent) {
      if (e.button !== 0 || e.pointerType === "touch") return;
      const target = e.target as HTMLElement;
      const el = target.closest<HTMLElement>("[data-appt][data-movable]");
      const colEl = el?.closest<HTMLElement>("[data-agenda-col]");
      if (!el || !colEl) return;
      drag = {
        el,
        block: readBlock(el),
        mode: target.closest("[data-resize]") ? "resize" : "move",
        x0: e.clientX,
        y0: e.clientY,
        grabOffset: e.clientY - el.getBoundingClientRect().top,
        colEl,
        active: false,
        cancelled: false,
        last: null,
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("keydown", onKey);
    }

    function onMove(e: PointerEvent) {
      if (!drag || drag.cancelled) return;
      if (!drag.active) {
        if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < THRESHOLD_PX) return;
        drag.active = true;
        drag.el.style.opacity = "0.35";
        document.body.style.userSelect = "none";
      }
      const b = drag.block;
      let { staffId, start, end } = b;

      if (drag.mode === "move") {
        // Otra columna = otra profesional
        drag.colEl = columnAt(e.clientX, e.clientY) ?? drag.colEl;
        staffId = Number(drag.colEl.dataset.agendaCol);
        const length = b.end - b.start;
        const top = e.clientY - drag.colEl.getBoundingClientRect().top - drag.grabOffset;
        const latest = Math.max(0, (we - ws - length) / MIN);
        start = ws + Math.min(Math.max(0, snap(top)), latest) * MIN;
        end = start + length;
      } else {
        // Estirar o acortar por abajo, nunca menos de 5 minutos
        const bottom = e.clientY - drag.colEl.getBoundingClientRect().top;
        end = Math.max(b.start + STEP * MIN, ws + Math.min(snap(bottom), (we - ws) / MIN) * MIN);
      }

      const hit = othersIn(drag.colEl, b.id).find((o) => start < o.end && o.start < end);
      const r = drag.colEl.getBoundingClientRect();
      drag.last = {
        mode: drag.mode,
        staffId,
        start,
        end,
        clashWith: hit ? hit.client : null,
        col: { left: r.left, top: r.top, width: r.width, height: r.height },
      };
      setGhost(drag.last);
    }

    function onUp() {
      const d = drag;
      stop();
      if (!d || !d.active) return; // fue un clic: abre la ficha como siempre
      swallowNextClick();
      const g = d.last;
      if (d.cancelled || !g || g.clashWith) return; // encima de otra cita: vuelve a su sitio
      const unchanged = g.staffId === d.block.staffId && g.start === d.block.start && g.end === d.block.end;
      if (unchanged) return;
      setProposal({ block: d.block, mode: d.mode, to: { staffId: g.staffId, start: g.start, end: g.end } });
    }

    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || !drag) return;
      // Esc: se suelta sin mover; el clic de soltar tampoco abre la ficha
      drag.cancelled = true;
      drag.el.style.opacity = "";
      setGhost(null);
    }

    // Que el navegador no arrastre la cita como si fuera un enlace
    function onDragStart(e: DragEvent) {
      if ((e.target as HTMLElement).closest?.("[data-movable]")) e.preventDefault();
    }

    grid.addEventListener("pointerdown", onDown);
    grid.addEventListener("dragstart", onDragStart);
    return () => {
      grid.removeEventListener("pointerdown", onDown);
      grid.removeEventListener("dragstart", onDragStart);
      stop();
    };
  }, [p.gridId, ws, we]);

  return (
    <>
      {ghost &&
        createPortal(
          <>
            {/* La columna de destino, un poco más oscura */}
            <div
              aria-hidden
              className="pointer-events-none fixed z-40 bg-foreground/[0.05]"
              style={ghost.col}
            />
            <div
              aria-hidden
              className={cn(
                "pointer-events-none fixed z-50 rounded-md border-2 px-2 py-1 text-xs shadow-lg",
                ghost.clashWith ? "border-danger bg-danger/15" : "border-foreground bg-card/95",
              )}
              style={{
                left: ghost.col.left + 4,
                width: ghost.col.width - 8,
                top: ghost.col.top + (ghost.start - ws) / MIN,
                height: Math.max(18, (ghost.end - ghost.start) / MIN),
              }}
            >
              <span className="block font-semibold tabular-nums">
                {hm(ghost.start)}–{hm(ghost.end)}
              </span>
              {ghost.clashWith && (
                <span className="block font-medium text-danger">{t("clashWith", { client: ghost.clashWith })}</span>
              )}
              {ghost.mode === "resize" && !ghost.clashWith && (
                <span className="absolute -bottom-8 right-0 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-background">
                  {t("until", { time: hm(ghost.end), duration: duration((ghost.end - ghost.start) / MIN) })}
                </span>
              )}
            </div>
          </>,
          document.body,
        )}
      {proposal && (
        <MoveDialog
          key={`${proposal.block.id}|${proposal.to.staffId}|${proposal.to.start}|${proposal.to.end}`}
          proposal={proposal}
          staff={p.staff}
          accounts={p.accounts}
          locale={p.locale}
          zone={p.zone}
          onClose={() => setProposal(null)}
        />
      )}
    </>
  );
}

// ---------- «¿Mover la cita?» ----------

const WARNING_TEXT = {
  outside_shift: "warn.outside_shift",
  time_off: "warn.time_off",
  block: "warn.block",
} as const;

const ERROR_TEXT = {
  invalid_input: "errors.invalid",
  not_found: "errors.notFound",
  not_changeable: "errors.notChangeable",
  no_change: "errors.noChange",
  staff_unavailable: "errors.staff",
  slot_taken: "errors.slotTaken",
  koibox_unavailable: "errors.koiboxDown",
  server: "errors.server",
} as const;

type MoveFailure = Extract<CheckStaffMoveResult | MoveStaffAppointmentResult, { ok: false }>;

function MoveDialog({
  proposal,
  staff,
  accounts,
  locale,
  zone,
  onClose,
}: {
  proposal: Proposal;
  staff: AgendaDragProps["staff"];
  accounts: AgendaDragProps["accounts"];
  locale: string;
  zone: string;
  onClose: () => void;
}) {
  const t = useTranslations("Admin.agenda.move");
  const router = useRouter();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [check, setCheck] = useState<CheckStaffMoveResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notify, setNotify] = useState(proposal.block.hasEmail);
  const [checking, startCheck] = useTransition();
  const [saving, startSave] = useTransition();

  const { block, to } = proposal;
  const change = {
    startsAt: new Date(to.start).toISOString(),
    staffId: to.staffId,
    durationMin: Math.round((to.end - to.start) / MIN),
  };
  const fromName = staff.find((s) => s.id === block.staffId)?.name ?? "";
  const toName = staff.find((s) => s.id === to.staffId)?.name ?? "";
  const onlyDuration = to.staffId === block.staffId && to.start === block.start;
  const hm = (ms: number) => formatTime(new Date(ms), locale, zone);
  const day = (ms: number) => DateTime.fromMillis(ms, { zone }).setLocale(locale).toFormat("cccc d LLL");
  const line = (start: number, end: number, name: string) =>
    `${day(start)} · ${hm(start)}–${hm(end)} · ${t("with", { staff: name })}`;
  const accountLabel = (a: string | null) => (a ? (accounts[a]?.label ?? a) : t("noAccount"));

  // Al abrir: se enseña el diálogo y se comprueba el cambio (sin hacerlo)
  useEffect(() => {
    dialog.current?.showModal();
    startCheck(async () => {
      setCheck(await checkStaffMoveAction(block.id, change));
    });
    // Solo al abrir: cada propuesta es un diálogo nuevo (key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const failureText = (r: MoveFailure): string => {
    switch (r.reason) {
      case "clash":
        return r.clash.kind === "appointment"
          ? t("clash", {
              client: r.clash.appointment.clientName,
              time: `${hm(new Date(r.clash.appointment.startsAt).getTime())}–${hm(new Date(r.clash.appointment.endsAt).getTime())}`,
            })
          : t("clashKoibox", {
              time: `${hm(new Date(r.clash.startsAt).getTime())}–${hm(new Date(r.clash.endsAt).getTime())}`,
            });
      case "service_not_done":
        return t("serviceNotDone", { staff: toName, services: r.serviceNames.join(", ") });
      case "needs_confirmation":
        return t("warnings", {
          warnings: r.warnings.map((w) => t(WARNING_TEXT[w], { staff: toName })).join(" · "),
        });
      default:
        return t(ERROR_TEXT[r.reason]);
    }
  };

  const warnings = check?.ok ? check.warnings : [];
  const canMove = check?.ok === true;

  const confirm = () =>
    startSave(async () => {
      const r = await moveStaffAppointmentAction(block.id, { ...change, force: warnings.length > 0 }, notify);
      if (r.ok) {
        dialog.current?.close();
        router.refresh();
        return;
      }
      setError(failureText(r));
    });

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-labelledby={titleId}
      className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-xl border bg-card p-5 text-foreground shadow-xl backdrop:bg-foreground/30"
    >
      <div className="space-y-4">
        <h2 id={titleId} className="text-lg font-semibold">
          {onlyDuration ? t("titleDuration") : t("title")}
        </h2>
        <div className="space-y-1">
          <p className="font-medium">
            {block.client} · {block.service}
          </p>
          <p className="text-sm text-muted-foreground line-through">{line(block.start, block.end, fromName)}</p>
          <p className="font-semibold">{line(to.start, to.end, toName)}</p>
        </div>

        {(checking || !check) && <p className="text-sm text-muted-foreground">{t("checking")}</p>}
        {check && !check.ok && (
          <p role="alert" className="rounded-lg border-l-4 border-danger bg-danger/10 px-3 py-2.5 text-sm">
            {failureText(check)}
          </p>
        )}
        {warnings.length > 0 && (
          <p role="status" className="rounded-lg border-l-4 border-warning bg-warning/15 px-3 py-2.5 text-sm">
            {t("warnings", { warnings: warnings.map((w) => t(WARNING_TEXT[w], { staff: toName })).join(" · ") })}
          </p>
        )}
        {check?.ok && check.accountChange && (
          <p className="rounded-lg bg-muted px-3 py-2.5 text-sm">
            {t("accountChange", {
              from: accountLabel(check.accountChange.from),
              to: accountLabel(check.accountChange.to),
            })}
          </p>
        )}

        <label className={cn("flex items-start gap-3", block.hasEmail ? "cursor-pointer" : "opacity-70")}>
          <input
            type="checkbox"
            checked={notify}
            disabled={!block.hasEmail}
            onChange={(e) => setNotify(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-foreground"
          />
          <span className="text-sm">
            <span className="font-medium">{t("notify")}</span>
            <span className="block text-xs text-muted-foreground">
              {block.hasEmail ? t("notifyHint") : t("notifyNoEmail")}
            </span>
          </span>
        </label>

        {error && (
          <p role="alert" className="rounded-lg border-l-4 border-danger bg-danger/10 px-3 py-2.5 text-sm">
            {error}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="inline-flex h-11 items-center rounded-md border bg-card px-4 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("keep")}
          </button>
          {canMove && (
            <Button type="button" onClick={confirm} disabled={saving || checking} className="h-11 px-5">
              {saving
                ? t("saving")
                : warnings.length > 0
                  ? t("moveAnyway")
                  : onlyDuration
                    ? t("changeDuration")
                    : t("move")}
            </Button>
          )}
        </div>
      </div>
    </dialog>
  );
}
"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  requestDepositCodeAction, verifyDepositCodeAction,
} from "@/app/[locale]/(site)/booking/actions";
import { formatTime } from "@/lib/format";

// «Tengo un depósito guardado» en el paso de datos y pago (diseños P2, P2b y P3b).
// 1. «Enviarme el código»: con el teléfono y el correo del formulario.
// 2. La clienta escribe el código y pulsa «Comprobar».
// 3. Con el código bueno, avisa al formulario (onVerified), que enseña P3 y manda la prueba.

export type SavedDepositInfo = {
  staffId: number; // la profesional que se espera que haga la cita
  zone: string; // zona horaria del salón, para las horas de los avisos
};

type Props = SavedDepositInfo & {
  locale: string;
  serviceIds: number[];
  depositAmount: string; // «15,00 €», para «Pagar el depósito»
  readContact: () => { phone: string; email: string };
  onSent: () => void; // ya se pidió un código: el formulario deja fijos teléfono y correo
  onVerified: (proof: string, amount: string) => void;
  onPayDeposit: () => void; // volver a «Solo el depósito»
};

type Step =
  | { kind: "idle"; notice?: "none" | "contact" | "server" }
  | {
      kind: "sent";
      requestId: string;
      maskedEmail: string;
      amount: string;
      expiresAt: string;
      notice?: "invalid" | "expired" | "server" | { attemptsLeft: number };
    }
  | { kind: "locked"; until: string; attempts: boolean };

const CODE = /^\d{6}$/;

export function SavedDeposit({
  locale, serviceIds, staffId, zone, depositAmount, readContact, onSent, onVerified, onPayDeposit,
}: Props) {
  const t = useTranslations("Booking.saved");
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [code, setCode] = useState("");
  const [busy, startTransition] = useTransition();
  const time = (iso: string) => formatTime(new Date(iso), locale, zone);

  function sendCode() {
    const { phone, email } = readContact();
    if (!phone.trim() || !email.trim()) {
      setStep({ kind: "idle", notice: "contact" });
      return;
    }
    startTransition(async () => {
      const r = await requestDepositCodeAction({ locale, phone, email, serviceIds, staffId });
      if (r.ok) {
        setCode("");
        setStep({ kind: "sent", requestId: r.requestId, maskedEmail: r.maskedEmail, amount: r.amount, expiresAt: r.expiresAt });
        onSent();
      } else if (r.reason === "locked") {
        setStep({ kind: "locked", until: r.until, attempts: false });
      } else {
        setStep({ kind: "idle", notice: r.reason === "invalid" ? "contact" : r.reason });
      }
    });
  }

  function check() {
    if (step.kind !== "sent") return;
    const typed = code.replace(/\s/g, "");
    if (!CODE.test(typed)) {
      setStep({ ...step, notice: "invalid" });
      return;
    }
    startTransition(async () => {
      const r = await verifyDepositCodeAction(step.requestId, typed);
      if (r.ok) onVerified(r.proof, step.amount);
      else if (r.reason === "locked") setStep({ kind: "locked", until: r.until, attempts: true });
      else if (r.reason === "wrong") setStep({ ...step, notice: { attemptsLeft: r.attemptsLeft } });
      else setStep({ ...step, notice: r.reason });
    });
  }

  const payDeposit = (
    <Button type="button" variant="outline" className="h-11 w-full" onClick={onPayDeposit}>
      {t("payDepositInstead", { amount: depositAmount })}
    </Button>
  );

  // P2b: ni comprobar ni pedir otro hasta que pase el bloqueo
  if (step.kind === "locked") {
    return (
      <div className="space-y-3">
        <p
          aria-hidden="true"
          className="flex h-14 items-center justify-center rounded-lg border bg-muted text-2xl tracking-[0.4em] text-muted-foreground"
        >
          ······
        </p>
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {step.attempts ? t("lockedAttempts", { time: time(step.until) }) : t("lockedWait", { time: time(step.until) })}
        </p>
        {payDeposit}
      </div>
    );
  }

  // P2: el código
  if (step.kind === "sent") {
    const notice = step.notice;
    const noticeText =
      notice === undefined
        ? null
        : typeof notice === "object"
          ? t("wrong", { left: notice.attemptsLeft })
          : { invalid: t("invalidCode"), expired: t("expired"), server: t("serverCheck") }[notice];
    return (
      <div className="space-y-2">
        <p className="text-sm">{t("sent", { email: step.maskedEmail })}</p>
        <label htmlFor="savedDepositCode" className="sr-only">
          {t("codeLabel")}
        </label>
        <input
          id="savedDepositCode"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))}
          // Intro aquí comprueba el código, no envía la reserva
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              check();
            }
          }}
          aria-invalid={notice !== undefined ? true : undefined}
          aria-describedby={noticeText ? "savedDepositCode-error" : undefined}
          className="h-14 w-full rounded-lg border-2 border-foreground bg-card text-center text-2xl tracking-[0.4em] outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive"
        />
        {noticeText && (
          <p id="savedDepositCode-error" role="alert" className="text-sm text-destructive">
            {noticeText}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          {t("expires", { time: time(step.expiresAt) })} ·{" "}
          <button
            type="button"
            onClick={sendCode}
            disabled={busy}
            className="underline underline-offset-4 disabled:opacity-50"
          >
            {t("resend")}
          </button>
        </p>
        <Button type="button" size="lg" className="h-11 w-full" disabled={busy} onClick={check}>
          {busy ? t("checking") : t("check")}
        </Button>
      </div>
    );
  }

  // Antes de pedirlo (y P3b: no hay depósito guardado para estos servicios)
  const notice = step.notice;
  return (
    <div className="space-y-3">
      {notice && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {{ none: t("none"), contact: t("needContact"), server: t("server") }[notice]}
        </p>
      )}
      <Button type="button" size="lg" variant="secondary" className="h-11 w-full" disabled={busy} onClick={sendCode}>
        {busy ? t("sending") : t("sendCode")}
      </Button>
      {notice === "none" && payDeposit}
    </div>
  );
}
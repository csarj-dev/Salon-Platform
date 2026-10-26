"use client";

import { useActionState, useEffect, useRef, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { submitBooking, type BookingFormState } from "@/app/[locale]/(site)/booking/actions";
import type { BookingHref } from "@/components/booking/step-ui";
import { cn } from "@/lib/utils";
import { DESKTOP_QUERY } from "@/lib/whatsapp-tab";

type Props = {
  locale: string;
  locationId: number;
  serviceId: number;
  staff: string; // id de la profesional o "any"
  at: string; // hora elegida (ISO, UTC)
  backHref: BookingHref; // volver a elegir otra hora
  opensWhatsApp?: boolean; // si al reservar se acabará en WhatsApp (depósito por WhatsApp)
};

const inputClass =
  "h-11 w-full rounded-lg border bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive";

function Field({
  id, label, error, children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function BookingForm({
  locale, locationId, serviceId, staff, at, backHref, opensWhatsApp = false,
}: Props) {
  const t = useTranslations("Booking");
  const router = useRouter();
  const [state, formAction, pending] = useActionState<BookingFormState, FormData>(
    submitBooking,
    {},
  );
  const [, startTransition] = useTransition();
  // Pestaña abierta en el clic para WhatsApp (solo ordenador); se rellena cuando responde el servidor
  const tabRef = useRef<Window | null>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    tabRef.current?.close(); // por si quedó una de un intento anterior
    tabRef.current = null;
    if (opensWhatsApp && window.matchMedia(DESKTOP_QUERY).matches) {
      // Tiene que abrirse AQUÍ, en el clic: si se abre después de esperar al servidor, el navegador la bloquea
      const tab = window.open("about:blank", "_blank");
      if (tab) {
        tab.opener = null; // la pestaña nueva no puede tocar la nuestra
        tabRef.current = tab;
        formData.set("whatsappTab", "1");
      }
      // Si se bloqueó (tab === null), no se avisa al servidor y se redirige como en móvil
    }
    startTransition(() => formAction(formData));
  }

  // Cuando responde el servidor: WhatsApp en la pestaña nueva y esta a la confirmación,
  // o, si hubo error, se cierra la pestaña vacía
  useEffect(() => {
    const tab = tabRef.current;
    if (state.done) {
      if (tab && !tab.closed && state.done.whatsappHref) tab.location.href = state.done.whatsappHref;
      else tab?.close();
      tabRef.current = null;
      router.replace(`/booking/confirmed/${state.done.publicToken}`);
    } else if (state.error) {
      tab?.close();
      tabRef.current = null;
    }
  }, [state, router]);
  const errorMessage = state.error
    ? {
        invalid: t("errorInvalid"),
        slot_taken: t("errorTaken"),
        slot_unavailable: t("errorUnavailable"),
        server: t("errorServer"),
      }[state.error]
    : null;
  const slotProblem = state.error === "slot_taken" || state.error === "slot_unavailable";

  return (
    <form action={formAction} onSubmit={handleSubmit} className="space-y-4" noValidate>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="location" value={locationId} />
      <input type="hidden" name="service" value={serviceId} />
      <input type="hidden" name="staff" value={staff} />
      <input type="hidden" name="at" value={at} />

      {errorMessage && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <p>{errorMessage}</p>
          {slotProblem && (
            <Link href={backHref} className="mt-1 inline-block underline underline-offset-4">
              {t("pickAnother")}
            </Link>
          )}
        </div>
      )}

      <Field id="name" label={t("name")} error={state.fields?.name ? t("errorName") : undefined}>
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          required
          defaultValue={state.values?.name}
          aria-invalid={state.fields?.name ? true : undefined}
          aria-describedby={state.fields?.name ? "name-error" : undefined}
          className={inputClass}
        />
      </Field>

      <Field id="phone" label={t("phone")} error={state.fields?.phone ? t("errorPhone") : undefined}>
        <input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          defaultValue={state.values?.phone}
          aria-invalid={state.fields?.phone ? true : undefined}
          aria-describedby={state.fields?.phone ? "phone-error" : undefined}
          className={inputClass}
        />
      </Field>

      <Field id="email" label={t("email")} error={state.fields?.email ? t("errorEmail") : undefined}>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.values?.email}
          aria-invalid={state.fields?.email ? true : undefined}
          aria-describedby={state.fields?.email ? "email-error" : undefined}
          className={inputClass}
        />
      </Field>

      <div className="space-y-1">
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="consent"
            required
            aria-invalid={state.fields?.consent ? true : undefined}
            aria-describedby={state.fields?.consent ? "consent-error" : undefined}
            className="mt-0.5 size-5 shrink-0"
          />
          <span>{t("consent")}</span>
        </label>
        {state.fields?.consent && (
          <p id="consent-error" className="text-sm text-destructive">
            {t("errorConsent")}
          </p>
        )}
      </div>

      <Button type="submit" size="lg" disabled={pending} className={cn("h-11 w-full px-5")}>
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}

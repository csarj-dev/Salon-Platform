"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { submitBooking, type BookingFormState } from "@/app/[locale]/booking/actions";
import type { BookingHref } from "@/components/booking/step-ui";
import { cn } from "@/lib/utils";

type Props = {
  locale: string;
  locationId: number;
  serviceId: number;
  staff: string; // id de la profesional o "any"
  at: string; // hora elegida (ISO, UTC)
  backHref: BookingHref; // volver a elegir otra hora
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

export function BookingForm({ locale, locationId, serviceId, staff, at, backHref }: Props) {
  const t = useTranslations("Booking");
  const [state, formAction, pending] = useActionState<BookingFormState, FormData>(
    submitBooking,
    {},
  );

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
    <form action={formAction} className="space-y-4" noValidate>
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

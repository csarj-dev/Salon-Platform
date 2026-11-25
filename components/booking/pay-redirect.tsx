"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { retryCardPaymentAction } from "@/app/[locale]/(site)/booking/confirmed/[token]/actions";
import type { PaymentForm } from "@/lib/redsys/gateway";

// Lleva a la clienta a la página de pago de Redsys: un formulario oculto que se envía solo.
// (Redsys pide un POST con los datos firmados, así que no basta con cambiar de dirección.)
export function PayRedirect({ form }: { form: PaymentForm }) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    ref.current?.submit();
  }, [form]);
  return (
    <form ref={ref} method="post" action={form.action} className="hidden" aria-hidden="true">
      {Object.entries(form.fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
    </form>
  );
}

type RetryProps = {
  token: string;
  locale: string;
  label: string; // «Probar otra vez · 15,00 €»
  pendingLabel: string; // «Abriendo el pago…»
  errorLabel: string;
};

// Botón de la página de la cita para volver a pagar el depósito con tarjeta
export function RetryPayment({ token, locale, label, pendingLabel, errorLabel }: RetryProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<PaymentForm | null>(null);
  const [error, setError] = useState(false);

  function retry() {
    setError(false);
    startTransition(async () => {
      const result = await retryCardPaymentAction(token, locale);
      if (result.ok) {
        setForm(result.form);
        return;
      }
      setError(true);
      // Puede que ya no haga falta (se pagó en otra pestaña, o se pasó el plazo): se repinta la página
      router.refresh();
    });
  }

  const busy = pending || form !== null;
  return (
    <div className="space-y-2">
      <Button type="button" size="lg" className="h-12 w-full px-5" disabled={busy} onClick={retry}>
        {busy ? pendingLabel : label}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {errorLabel}
        </p>
      )}
      {form && <PayRedirect form={form} />}
    </div>
  );
}
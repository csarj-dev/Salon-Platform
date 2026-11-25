import { Suspense } from "react";
import type { Metadata } from "next";
import { StepSkeleton } from "@/components/booking/step-skeleton";
import { ConfirmationContent } from "@/components/booking/confirmation-content";

type Props = {
  params: Promise<{ locale: string; token: string }>;
  // ?pay=ok|ko: vuelve de la página de pago con tarjeta (app/api/payments/redsys/return)
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// El enlace es privado (lleva el token de la cita): que los buscadores no lo indexen
export const metadata: Metadata = { robots: { index: false, follow: false } };

// No es async a propósito: `params` se lee dentro de <Suspense> (ver ConfirmationContent)
// No es async a propósito: params y searchParams se leen dentro de <Suspense> (ver ConfirmationContent)
export default function ConfirmedPage({ params, searchParams }: Props) {
  return (
    <main>
      <Suspense
        fallback={
          <div className="mx-auto max-w-xl px-6 py-8">
            <StepSkeleton />
          </div>
        }
      >
        <ConfirmationContent params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

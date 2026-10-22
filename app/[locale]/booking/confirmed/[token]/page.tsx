import { Suspense } from "react";
import type { Metadata } from "next";
import { StepSkeleton } from "@/components/booking/step-skeleton";
import { ConfirmationContent } from "@/components/booking/confirmation-content";

type Props = { params: Promise<{ locale: string; token: string }> };

// El enlace es privado (lleva el token de la cita): que los buscadores no lo indexen
export const metadata: Metadata = { robots: { index: false, follow: false } };

// No es async a propósito: `params` se lee dentro de <Suspense> (ver ConfirmationContent)
export default function ConfirmedPage({ params }: Props) {
  return (
    <main>
      <Suspense
        fallback={
          <div className="mx-auto max-w-xl px-6 py-8">
            <StepSkeleton />
          </div>
        }
      >
        <ConfirmationContent params={params} />
      </Suspense>
    </main>
  );
}

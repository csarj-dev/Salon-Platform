import { Suspense } from "react";
import type { Metadata } from "next";
import { StepSkeleton } from "@/components/booking/step-skeleton";
import { RescheduleContent } from "@/components/booking/reschedule-content";

type Props = {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// El enlace es privado (lleva el token de la cita): que los buscadores no lo indexen
export const metadata: Metadata = { robots: { index: false, follow: false } };

// No es async a propósito: params y searchParams se leen dentro de <Suspense>
export default function ChangeAppointmentPage({ params, searchParams }: Props) {
  return (
    <main>
      <Suspense
        fallback={
          <div className="mx-auto max-w-xl px-6 py-8">
            <StepSkeleton />
          </div>
        }
      >
        <RescheduleContent params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
import { Suspense } from "react";
import { StepSkeleton } from "@/components/booking/step-skeleton";
import { ServiceDetailContent } from "@/components/showcase/service-detail-content";

type Props = { params: Promise<{ locale: string; slug: string }> };

// No es async a propósito: `params` se lee dentro de <Suspense> (ver ServiceDetailContent)
export default function ServiceDetailPage({ params }: Props) {
  return (
    <main>
      <Suspense
        fallback={
          <div className="mx-auto max-w-3xl px-6 py-8">
            <StepSkeleton />
          </div>
        }
      >
        <ServiceDetailContent params={params} />
      </Suspense>
    </main>
  );
}
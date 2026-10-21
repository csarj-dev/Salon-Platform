import { Suspense } from "react";
import { StepSkeleton } from "@/components/booking/step-skeleton";
import { LocationContent } from "@/components/showcase/location-content";

type Props = { params: Promise<{ locale: string; slug: string }> };

// No es async a propósito: `params` se lee dentro de <Suspense> (ver LocationContent)
export default function LocationPage({ params }: Props) {
  return (
    <main>
      <Suspense
        fallback={
          <div className="mx-auto max-w-3xl px-6 py-8">
            <StepSkeleton />
          </div>
        }
      >
        <LocationContent params={params} />
      </Suspense>
    </main>
  );
}
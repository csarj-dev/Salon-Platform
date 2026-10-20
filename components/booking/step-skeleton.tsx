import { Skeleton } from "@/components/ui/skeleton";

export function StepSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}
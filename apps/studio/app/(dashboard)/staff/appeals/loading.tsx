import { Skeleton } from '@/components/ui/skeleton';

export default function AppealsLoading() {
  return (
    <div className="max-w-5xl space-y-8" aria-busy="true" aria-label="Loading appeals">
      <div className="space-y-2">
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    </div>
  );
}

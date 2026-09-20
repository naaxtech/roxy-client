import { Skeleton } from '@/components/ui/skeleton';

export default function ArchiveDashboardLoading() {
  return (
    <div className="max-w-5xl space-y-8" aria-busy="true" aria-label="Loading Archive dashboard">
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>

      <div className="space-y-3">
        <Skeleton className="h-5 w-44" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>

      <div className="space-y-3">
        <Skeleton className="h-5 w-36" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    </div>
  );
}

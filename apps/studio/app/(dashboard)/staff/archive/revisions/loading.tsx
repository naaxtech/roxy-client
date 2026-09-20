import { Skeleton } from '@/components/ui/skeleton';

export default function RevisionQueueLoading() {
  return (
    <div className="max-w-5xl space-y-8" aria-busy="true" aria-label="Loading revision queue">
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-5 w-32" />
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <div className="space-y-3">
        <Skeleton className="h-5 w-36" />
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    </div>
  );
}

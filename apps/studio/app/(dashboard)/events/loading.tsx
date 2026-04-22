import { Skeleton } from '@/components/ui/skeleton';

export default function EventsLoading() {
  return (
    <div className="space-y-8 max-w-3xl">
      <div className="space-y-2">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-4 w-56" />
      </div>
      {/* Form skeleton */}
      <div className="rounded-xl border border-border/50 bg-card p-5 space-y-4">
        <Skeleton className="h-5 w-32" />
        <div className="grid grid-cols-2 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-9 rounded-md" />)}
        </div>
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>
      {/* List skeleton */}
      <div className="space-y-3">
        <Skeleton className="h-5 w-28" />
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-lg border p-4 flex items-center justify-between">
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-36" />
            </div>
            <Skeleton className="h-6 w-14 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

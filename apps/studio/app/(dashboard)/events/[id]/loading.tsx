import { Skeleton } from '@/components/ui/skeleton';

export default function EventDetailLoading() {
  return (
    <div className="space-y-6 max-w-3xl">
      {/* Back link */}
      <Skeleton className="h-4 w-24" />

      {/* Title + meta */}
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <div className="flex gap-3">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-28 rounded-full" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <Skeleton className="h-4 w-48" />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="rounded-xl border border-border/50 bg-card p-4 space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-7 w-12" />
          </div>
        ))}
      </div>

      {/* Attendee list */}
      <div className="rounded-xl border border-border/50 bg-card p-5 space-y-3">
        <Skeleton className="h-5 w-32 mb-4" />
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-full shrink-0" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

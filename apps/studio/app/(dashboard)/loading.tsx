import { Skeleton } from '@/components/ui/skeleton';

export default function DashboardLoading() {
  return (
    <div className="space-y-6 pb-16">
      {/* Page title */}
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>

      {/* Metric cards row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-xl border border-border/50 bg-card p-4 space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>

      {/* Content block */}
      <div className="rounded-xl border border-border/50 bg-card p-5 space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-full max-w-xs" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-7 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

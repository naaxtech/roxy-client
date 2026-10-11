import { Skeleton } from '@/components/ui/skeleton';

export default function StaffReportsLoading() {
  return (
    <div className="max-w-6xl space-y-6" aria-busy="true" aria-label="Loading reports">
      <div className="space-y-2">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div className="flex gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-6 w-20 rounded-full" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    </div>
  );
}

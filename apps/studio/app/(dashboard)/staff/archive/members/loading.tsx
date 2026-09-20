import { Skeleton } from '@/components/ui/skeleton';

export default function MemberQueueLoading() {
  return (
    <div className="max-w-5xl space-y-8" aria-busy="true" aria-label="Loading member queue">
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <Skeleton className="h-14 w-full" />
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    </div>
  );
}

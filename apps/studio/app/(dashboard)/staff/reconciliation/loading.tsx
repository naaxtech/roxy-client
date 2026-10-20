import { Skeleton } from '@/components/ui/skeleton';

export default function StaffReconciliationLoading() {
  return (
    <div className="max-w-5xl space-y-6" aria-busy="true" aria-label="Loading reconciliation alerts">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    </div>
  );
}

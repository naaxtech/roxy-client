import { Skeleton } from '@/components/ui/skeleton';

export default function StaffMembersLoading() {
  return (
    <div className="max-w-5xl space-y-6" aria-busy="true" aria-label="Loading members">
      <div className="space-y-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <Skeleton className="h-9 w-full max-w-xl" />
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    </div>
  );
}

import { Skeleton } from '@/components/ui/skeleton';

export default function InvitesLoading() {
  return (
    <div className="max-w-5xl space-y-8" aria-busy="true" aria-label="Loading invite codes">
      <div className="space-y-2">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>

      <div className="rounded-lg border p-5 space-y-4">
        <Skeleton className="h-5 w-32" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
        <Skeleton className="h-9 w-40" />
      </div>

      <div className="space-y-3">
        <Skeleton className="h-5 w-28" />
        <div className="rounded-lg border divide-y">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="flex items-center gap-4 p-4">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="ml-auto h-8 w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

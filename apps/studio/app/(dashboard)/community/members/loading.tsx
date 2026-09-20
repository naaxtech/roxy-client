import { Skeleton } from '@/components/ui/skeleton';

export default function MembersLoading() {
  return (
    <div className="max-w-5xl space-y-8" aria-busy="true" aria-label="Loading members">
      <div className="space-y-2">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>

      <Skeleton className="h-9 w-full max-w-sm" />

      <div className="space-y-3">
        <Skeleton className="h-5 w-40" />
        <div className="rounded-lg border divide-y">
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="flex items-center gap-4 p-4">
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="ml-auto h-9 w-44" />
              <Skeleton className="h-8 w-24" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

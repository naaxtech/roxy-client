export default function Loading() {
  return (
    <div className="max-w-5xl space-y-8" aria-busy="true" aria-label="Loading Roxy team">
      <div className="space-y-2">
        <div className="h-8 w-40 rounded bg-muted animate-pulse" />
        <div className="h-4 w-96 max-w-full rounded bg-muted animate-pulse" />
      </div>
      <div className="h-64 rounded-lg border bg-muted/20 animate-pulse" />
    </div>
  );
}

/**
 * "We could not load X" — the state a page shows when its query FAILED.
 *
 * Staff queues used to read `data ?? []` and render "None." on any error, so
 * a timeout or an expired session looked exactly like an empty queue (ST-04).
 * Use this wherever a list would otherwise fall back to empty.
 */
export function QueryError({ what, className }: { what: string; className?: string }) {
  return (
    <div
      role="alert"
      className={`border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3 max-w-prose ${className ?? ''}`}
    >
      <p className="text-sm text-destructive">
        We could not load {what}. This is a loading failure, not an empty list — reload before you act on it. If it
        keeps failing, your session may have expired.
      </p>
    </div>
  );
}

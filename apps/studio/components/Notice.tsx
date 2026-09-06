import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Status callout. Copy uses theme foreground so it stays readable on both
 * the purple dark theme and the warm paper light theme — amber is the
 * accent only, never the sentence colour.
 */
export function Notice({
  title,
  children,
  action,
  className,
}: {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-xl border border-border bg-muted/50 px-4 py-3.5 border-l-[3px] border-l-amber-700',
        className,
      )}
    >
      <AlertCircle className="notice-icon h-4 w-4 shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {children ? <div className="mt-0.5 text-xs text-muted-foreground">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

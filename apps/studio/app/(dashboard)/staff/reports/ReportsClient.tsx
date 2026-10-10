'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  RESOLUTION_NOTE_MAX,
  canHide,
  contentTypeLabel,
  reasonLabel,
  type ResolutionChoice,
} from '@/lib/reports';
import { resolveReport } from './actions';

export interface ReportView {
  id: string;
  contentType: string;
  contentId: string | null;
  reason: string;
  detail: string | null;
  status: string;
  createdLabel: string;
  reporterName: string;
  reportedName: string;
  reportedUserId: string;
  preview: string | null;
  contentGone: boolean;
  sameTargetPending: number;
  resolvedLabel: string | null;
  resolvedByName: string | null;
  resolutionNote: string | null;
  resolutionAction: string | null;
}

const STATUS_VARIANT: Record<string, 'destructive' | 'secondary' | 'outline'> = {
  pending: 'destructive',
  actioned: 'secondary',
  dismissed: 'outline',
};

function TargetCount({ n, type }: { n: number; type: string }) {
  if (n <= 1) return null;
  return (
    <span className="text-xs font-medium text-destructive">
      {n} pending reports on this {contentTypeLabel(type).toLowerCase()}
    </span>
  );
}

export function ReportsClient({
  reports,
  resolutionLive,
}: {
  reports: ReportView[];
  resolutionLive: boolean;
}) {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState<string | null>(reports[0]?.id ?? null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<ResolutionChoice | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = reports.find((r) => r.id === selectedId) ?? reports[0] ?? null;

  const select = (id: string) => {
    setSelectedId(id);
    setNote('');
    setError(null);
  };

  const run = async (choice: ResolutionChoice) => {
    if (!selected) return;
    if (choice === 'suspend' || choice === 'hide_suspend') {
      const ok = window.confirm(
        `Suspend ${selected.reportedName}? She is signed out everywhere and cannot sign back in until core staff lift it.`,
      );
      if (!ok) return;
    }
    setBusy(choice);
    setError(null);
    setStatus(null);
    try {
      const result = await resolveReport(selected.id, choice, note);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setStatus(result.message);
      setNote('');
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not resolve that report. Try again.');
    } finally {
      setBusy(null);
    }
  };

  const disabled = !resolutionLive || busy !== null || isRefreshing;

  return (
    <div className="space-y-3">
      <div role="status" aria-live="polite" className="min-h-5 text-sm text-foreground">
        {status}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <ul className="divide-y border rounded-lg overflow-hidden" aria-label="Reports">
          {reports.map((r) => {
            const active = selected?.id === r.id;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => select(r.id)}
                  aria-label={`Open report: ${contentTypeLabel(r.contentType)}, ${reasonLabel(r.reason)}, about ${r.reportedName}`}
                  aria-pressed={active}
                  className={`w-full text-left p-3 space-y-1 ${active ? 'bg-muted' : 'hover:bg-muted/40'}`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline">{contentTypeLabel(r.contentType)}</Badge>
                    <span className="text-sm font-medium">{reasonLabel(r.reason)}</span>
                    <Badge variant={STATUS_VARIANT[r.status] ?? 'outline'} className="ml-auto">
                      {r.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    About {r.reportedName} · {r.createdLabel}
                  </p>
                  <TargetCount n={r.sameTargetPending} type={r.contentType} />
                </button>
              </li>
            );
          })}
        </ul>

        {selected && (
          <section aria-label="Report detail" className="border rounded-lg p-4 space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline">{contentTypeLabel(selected.contentType)}</Badge>
              <span className="font-semibold">{reasonLabel(selected.reason)}</span>
              <Badge variant={STATUS_VARIANT[selected.status] ?? 'outline'}>{selected.status}</Badge>
            </div>

            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Reported by</dt>
              <dd>{selected.reporterName}</dd>
              <dt className="text-muted-foreground">About</dt>
              <dd>{selected.reportedName}</dd>
              <dt className="text-muted-foreground">Filed</dt>
              <dd>{selected.createdLabel}</dd>
            </dl>

            <TargetCount n={selected.sameTargetPending} type={selected.contentType} />

            {selected.detail && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">What she told us</p>
                <p className="text-sm whitespace-pre-wrap">{selected.detail}</p>
              </div>
            )}

            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Reported content</p>
              {selected.preview ? (
                <blockquote className="text-sm border-l-2 pl-3 whitespace-pre-wrap">{selected.preview}</blockquote>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {selected.contentType === 'message' || selected.contentType === 'speed_date'
                    ? 'Private conversations are not shown in Studio. Judge from the report and the member’s history.'
                    : selected.contentType === 'profile'
                      ? 'The report is about her profile.'
                      : 'The content could not be loaded — it may already be deleted.'}
                </p>
              )}
              {selected.contentGone && (
                <p className="text-xs text-muted-foreground">This content is already hidden or closed.</p>
              )}
            </div>

            {selected.status === 'pending' ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="resolution-note">
                    Note <span className="font-normal text-muted-foreground">(optional, staff only)</span>
                  </Label>
                  <Textarea
                    id="resolution-note"
                    value={note}
                    maxLength={RESOLUTION_NOTE_MAX}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    placeholder="Why you decided this. It goes into the audit log."
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" disabled={disabled} onClick={() => void run('dismiss')}>
                    {busy === 'dismiss' ? 'Dismissing…' : 'Dismiss'}
                  </Button>
                  <Button variant="secondary" size="sm" disabled={disabled} onClick={() => void run('action')}>
                    {busy === 'action' ? 'Saving…' : 'Action'}
                  </Button>
                  {canHide(selected.contentType) && selected.contentId && (
                    <Button variant="secondary" size="sm" disabled={disabled} onClick={() => void run('hide')}>
                      {busy === 'hide' ? 'Hiding…' : 'Hide content'}
                    </Button>
                  )}
                  {canHide(selected.contentType) && selected.contentId ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={disabled}
                      onClick={() => void run('hide_suspend')}
                    >
                      {busy === 'hide_suspend' ? 'Suspending…' : 'Hide + suspend'}
                    </Button>
                  ) : (
                    <Button variant="destructive" size="sm" disabled={disabled} onClick={() => void run('suspend')}>
                      {busy === 'suspend' ? 'Suspending…' : 'Action + suspend'}
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground max-w-prose">
                  Dismiss: no violation. Action: a violation, handled outside Studio. Hide removes the
                  post, Archive item or room. Suspend signs her out everywhere until core staff lift it.
                </p>
              </div>
            ) : (
              <div className="text-sm space-y-1 border-t pt-3">
                <p>
                  {selected.status === 'dismissed' ? 'Dismissed' : 'Actioned'}
                  {selected.resolutionAction ? ` (${selected.resolutionAction})` : ''}
                  {selected.resolvedByName ? ` by ${selected.resolvedByName}` : ''}
                  {selected.resolvedLabel ? ` · ${selected.resolvedLabel}` : ''}
                </p>
                {selected.resolutionNote && (
                  <p className="text-muted-foreground whitespace-pre-wrap">{selected.resolutionNote}</p>
                )}
              </div>
            )}

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

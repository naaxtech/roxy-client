'use client';

import { useState, useTransition } from 'react';
import { Mail } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { QuickSearch } from '@/components/QuickSearch';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { formatUtcDateTime } from '@/lib/dates';
import { feedbackReplyMailto, feedbackReporterName } from '@/lib/feedbackReply';
import { updateFeedbackStatus, updateFeedbackNotes } from './actions';

type FeedbackCategory = 'bug' | 'broken' | 'other';
type FeedbackStatus = 'open' | 'in_review' | 'resolved' | 'wontfix';

export interface Feedback {
  id: string;
  user_id: string;
  category: FeedbackCategory;
  rating: number | null;
  message: string;
  screen_context: string | null;
  app_version: string | null;
  platform: string | null;
  status: FeedbackStatus;
  internal_notes: string | null;
  created_at: string;
  reporterName: string;
  reporterEmail: string | null;
}

const STATUS_COLORS: Record<FeedbackStatus, string> = {
  open: 'bg-muted text-muted-foreground',
  in_review: 'bg-amber-500/20 text-amber-400',
  resolved: 'bg-emerald-500/20 text-emerald-400',
  wontfix: 'bg-red-500/20 text-red-400',
};

const STATUS_LABELS: Record<FeedbackStatus, string> = {
  open: 'Open',
  in_review: 'In Review',
  resolved: 'Resolved',
  wontfix: "Won't Fix",
};

const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  bug: 'Crash',
  broken: 'Broken',
  other: 'Other',
};

function FeedbackRow({ feedback }: { feedback: Feedback }) {
  const [status, setStatus] = useState<FeedbackStatus>(feedback.status);
  const [notes, setNotes] = useState(feedback.internal_notes ?? '');
  const [isPending, startTransition] = useTransition();
  const reportedAt = formatUtcDateTime(feedback.created_at);
  const mailto = feedback.reporterEmail
    ? feedbackReplyMailto({
        email: feedback.reporterEmail,
        reporterName: feedback.reporterName,
        reportedAt,
        message: feedback.message,
        categoryLabel: CATEGORY_LABELS[feedback.category],
      })
    : null;

  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const s = e.target.value as FeedbackStatus;
    setStatus(s);
    startTransition(() => updateFeedbackStatus(feedback.id, s));
  };

  const handleNotesBlur = () => {
    if (notes !== (feedback.internal_notes ?? '')) {
      startTransition(() => updateFeedbackNotes(feedback.id, notes));
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/50 bg-card p-4 hover:border-border transition-colors">
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-[10px] px-2 py-0">{CATEGORY_LABELS[feedback.category]}</Badge>
            {feedback.rating != null && <span className="text-xs text-muted-foreground">{'⭐'.repeat(feedback.rating)}</span>}
          </div>
          <p className="text-sm font-medium text-foreground">{feedback.reporterName}</p>
          <p className="text-xs text-muted-foreground">{reportedAt}</p>
          <p className="text-sm text-foreground leading-relaxed pt-1">{feedback.message}</p>
          <p className="text-[10px] text-muted-foreground/50">
            {feedback.screen_context ?? 'unknown screen'} · v{feedback.app_version ?? '?'} · {feedback.platform ?? '?'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <Badge className={cn('text-[11px] px-2 py-0.5', STATUS_COLORS[status])}>
              {STATUS_LABELS[status]}
            </Badge>
            <Select value={status} onChange={handleStatusChange} disabled={isPending} className="h-8 w-32 text-xs">
              <option value="open">Open</option>
              <option value="in_review">In Review</option>
              <option value="resolved">Resolved</option>
              <option value="wontfix">Won&apos;t Fix</option>
            </Select>
          </div>
          {mailto ? (
            <Button asChild variant="outline" size="sm">
              <a href={mailto}>
                <Mail className="h-3.5 w-3.5" />
                Email {feedback.reporterName}
              </a>
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground max-w-[12rem] text-right">
              No email on file for this account.
            </p>
          )}
        </div>
      </div>
      <textarea
        className="w-full rounded-lg border border-border/50 bg-background p-2 text-xs text-foreground"
        placeholder="Internal notes (not visible to the user)"
        rows={2}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={handleNotesBlur}
      />
    </div>
  );
}

export function FeedbackClient({ initialFeedback }: { initialFeedback: Feedback[] }) {
  const [categoryFilter, setCategoryFilter] = useState<'all' | FeedbackCategory>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | FeedbackStatus>('all');
  const [query, setQuery] = useState('');

  const filtered = initialFeedback.filter((f) => {
    if (categoryFilter !== 'all' && f.category !== categoryFilter) return false;
    if (statusFilter !== 'all' && f.status !== statusFilter) return false;
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    const haystack = [
      f.message,
      f.reporterName,
      f.reporterEmail ?? '',
      f.screen_context ?? '',
      f.internal_notes ?? '',
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });

  const open = initialFeedback.filter((f) => f.status === 'open').length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-border/50 bg-card p-4 flex items-center gap-3">
          <span className="text-2xl">📬</span>
          <div>
            <p className="text-2xl font-bold text-foreground tabular-nums">{open}</p>
            <p className="text-xs text-muted-foreground">Open reports</p>
          </div>
        </div>
        <div className="rounded-xl border border-border/50 bg-card p-4 flex items-center gap-3">
          <span className="text-2xl">📋</span>
          <div>
            <p className="text-2xl font-bold text-foreground tabular-nums">{initialFeedback.length}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </div>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap items-end">
        <QuickSearch
          id="feedback-q"
          label="Search reports"
          value={query}
          placeholder="Message, name, email…"
          onChange={setQuery}
          className="min-w-[14rem] max-w-sm"
        />
        <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as typeof categoryFilter)} className="h-9 w-40 text-sm">
          <option value="all">All categories</option>
          <option value="bug">Crash</option>
          <option value="broken">Broken</option>
          <option value="other">Other</option>
        </Select>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="h-9 w-40 text-sm">
          <option value="all">All statuses</option>
          <option value="open">Open</option>
          <option value="in_review">In Review</option>
          <option value="resolved">Resolved</option>
          <option value="wontfix">Won&apos;t Fix</option>
        </Select>
        <span className="text-sm text-muted-foreground">{filtered.length} of {initialFeedback.length}</span>
      </div>

      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/50 p-12 text-center">
            <p className="text-muted-foreground">No feedback matches this filter.</p>
          </div>
        ) : (
          filtered.map((f) => <FeedbackRow key={f.id} feedback={f} />)
        )}
      </div>
    </div>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { updateFeatureStatus } from './actions';

type FeatureStatus = 'open' | 'in_progress' | 'done' | 'rejected';
type FeatureType = 'planned' | 'pitched';

interface FeatureRequest {
  id: string;
  title: string;
  description: string | null;
  type: FeatureType;
  status: FeatureStatus;
  vote_count: number;
  created_at: string;
  created_by: string | null;
}

const STATUS_COLORS: Record<FeatureStatus, string> = {
  open: 'bg-muted text-muted-foreground',
  in_progress: 'bg-amber-500/20 text-amber-400',
  done: 'bg-emerald-500/20 text-emerald-400',
  rejected: 'bg-red-500/20 text-red-400',
};

const STATUS_LABELS: Record<FeatureStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  done: 'Done',
  rejected: 'Rejected',
};

function FeatureRow({ feature }: { feature: FeatureRequest }) {
  const [status, setStatus] = useState<FeatureStatus>(feature.status);
  const [isPending, startTransition] = useTransition();

  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const s = e.target.value as FeatureStatus;
    setStatus(s);
    startTransition(() => updateFeatureStatus(feature.id, s));
  };

  return (
    <div className="flex items-start gap-4 rounded-xl border border-border/50 bg-card p-4 hover:border-border transition-colors">
      {/* Vote count */}
      <div className="flex flex-col items-center justify-center min-w-[52px] gap-0.5">
        <span className="text-xl">💜</span>
        <span className="text-lg font-bold text-foreground tabular-nums">{feature.vote_count}</span>
        <span className="text-[10px] text-muted-foreground/60">votes</span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-semibold text-foreground text-sm leading-snug">{feature.title}</h3>
          {feature.type === 'planned' && (
            <Badge variant="outline" className="text-primary border-primary/40 bg-primary/10 text-[10px] px-2 py-0">
              Roxy Pick
            </Badge>
          )}
        </div>
        {feature.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{feature.description}</p>
        )}
        <p className="text-[10px] text-muted-foreground/50">
          {new Date(feature.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          {feature.type === 'pitched' ? ' · Community pitch' : ' · Staff selected'}
        </p>
      </div>

      {/* Status selector */}
      <div className="flex items-center gap-2 shrink-0">
        <Badge className={cn('text-[11px] px-2 py-0.5', STATUS_COLORS[status])}>
          {STATUS_LABELS[status]}
        </Badge>
        <Select
          value={status}
          onChange={handleStatusChange}
          disabled={isPending}
          className="h-8 w-36 text-xs"
        >
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="done">Done</option>
          <option value="rejected">Rejected</option>
        </Select>
      </div>
    </div>
  );
}

export function FeatureRequestsClient({ initialFeatures }: { initialFeatures: FeatureRequest[] }) {
  const [typeFilter, setTypeFilter] = useState<'all' | FeatureType>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | FeatureStatus>('all');

  const filtered = initialFeatures.filter((f) => {
    if (typeFilter !== 'all' && f.type !== typeFilter) return false;
    if (statusFilter !== 'all' && f.status !== statusFilter) return false;
    return true;
  });

  const planned = initialFeatures.filter((f) => f.type === 'planned').length;
  const pitched = initialFeatures.filter((f) => f.type === 'pitched').length;
  const totalVotes = initialFeatures.reduce((sum, f) => sum + f.vote_count, 0);

  return (
    <div className="space-y-5">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Roxy Picks', value: planned, emoji: '💜' },
          { label: 'Community Pitches', value: pitched, emoji: '💡' },
          { label: 'Total Votes', value: totalVotes, emoji: '🗳️' },
        ].map(({ label, value, emoji }) => (
          <div key={label} className="rounded-xl border border-border/50 bg-card p-4 flex items-center gap-3">
            <span className="text-2xl">{emoji}</span>
            <div>
              <p className="text-2xl font-bold text-foreground tabular-nums">{value}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <Select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
          className="h-9 w-44 text-sm"
        >
          <option value="all">All types</option>
          <option value="planned">Roxy Picks</option>
          <option value="pitched">Community Pitches</option>
        </Select>
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="h-9 w-44 text-sm"
        >
          <option value="all">All statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="done">Done</option>
          <option value="rejected">Rejected</option>
        </Select>
        <span className="text-sm text-muted-foreground">
          {filtered.length} of {initialFeatures.length} features
        </span>
      </div>

      {/* Feature list */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/50 p-12 text-center">
            <p className="text-muted-foreground">No features match this filter.</p>
          </div>
        ) : (
          filtered.map((f) => <FeatureRow key={f.id} feature={f} />)
        )}
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { GameStatus } from '@/lib/games';

interface Props {
  gameId: string;
  stage: 'pitch' | 'build';
}

type ReviewAction = 'approved' | 'rejected' | 'changes_requested';

const NEW_STATUS: Record<'pitch' | 'build', Record<ReviewAction, GameStatus>> = {
  pitch: {
    approved: 'pitch_approved',
    rejected: 'pitch_rejected',
    changes_requested: 'pitch_pending', // keep pending, feedback shown
  },
  build: {
    approved: 'live',
    rejected: 'pitch_approved', // send back to build start
    changes_requested: 'build_changes',
  },
};

export function StaffReviewForm({ gameId, stage }: Props) {
  const router = useRouter();
  const supabase = createClient();

  const [feedback, setFeedback] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState<ReviewAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(action: ReviewAction) {
    if (submitting) return;
    if ((action === 'rejected' || action === 'changes_requested') && !feedback.trim()) {
      setError('Feedback is required when rejecting or requesting changes.');
      return;
    }
    setSubmitting(action);
    setError(null);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('Not logged in.'); setSubmitting(null); return; }

    const newStatus = NEW_STATUS[stage][action];

    const { error: updateErr } = await supabase
      .from('games')
      .update({ status: newStatus })
      .eq('id', gameId);

    if (updateErr) { setError(updateErr.message); setSubmitting(null); return; }

    const { error: eventErr } = await supabase
      .from('game_submission_events')
      .insert({
        game_id: gameId,
        stage,
        action,
        actor_id: user.id,
        developer_notes: notes.trim() || null,
        roxy_feedback: feedback.trim() || null,
        attachments: [],
      });

    if (eventErr) { setError(eventErr.message); setSubmitting(null); return; }

    router.push('/staff/games');
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <h2 className="font-semibold">
        Review {stage === 'pitch' ? 'Pitch' : 'Build'}
      </h2>

      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor="roxy-feedback">
          Feedback to developer
          <span className="text-muted-foreground font-normal ml-1">(required for reject / changes)</span>
        </label>
        <textarea
          id="roxy-feedback"
          rows={5}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder={
            stage === 'pitch'
              ? "What did you like? What's missing? Is the concept WLW-appropriate?"
              : "Does the build work? What needs fixing? What's the quality bar issue?"
          }
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor="internal-notes">
          Internal notes <span className="text-muted-foreground font-normal">(not shown to developer)</span>
        </label>
        <textarea
          id="internal-notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any notes for the team..."
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none"
        />
      </div>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
      )}

      <div className="flex flex-col gap-2">
        <button
          onClick={() => submit('approved')}
          disabled={!!submitting}
          className="w-full rounded-lg bg-green-600 text-white py-2.5 text-sm font-semibold hover:bg-green-700 disabled:opacity-50"
        >
          {submitting === 'approved' ? 'Approving…' : stage === 'build' ? '✓ Approve — Go Live' : '✓ Approve Pitch'}
        </button>
        <button
          onClick={() => submit('changes_requested')}
          disabled={!!submitting}
          className="w-full rounded-lg bg-orange-500 text-white py-2.5 text-sm font-semibold hover:bg-orange-600 disabled:opacity-50"
        >
          {submitting === 'changes_requested' ? 'Saving…' : 'Request Changes'}
        </button>
        <button
          onClick={() => submit('rejected')}
          disabled={!!submitting}
          className="w-full rounded-lg bg-destructive text-destructive-foreground py-2.5 text-sm font-semibold hover:bg-destructive/90 disabled:opacity-50"
        >
          {submitting === 'rejected' ? 'Rejecting…' : 'Reject'}
        </button>
      </div>
    </div>
  );
}

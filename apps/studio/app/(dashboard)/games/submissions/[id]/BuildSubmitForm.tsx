'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { GameStatus } from '@/lib/games';

interface Props {
  gameId: string;
  status: GameStatus;
}

export function BuildSubmitForm({ gameId, status }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const isResubmit = status === 'build_changes';

  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const trimmedUrl = url.trim();
    if (!trimmedUrl.startsWith('https://')) {
      setError('Game URL must start with https://');
      setSubmitting(false);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('Not logged in.'); setSubmitting(false); return; }

    // Update game URL + status
    const { error: updateErr } = await supabase
      .from('games')
      .update({ url: trimmedUrl, status: 'build_pending' })
      .eq('id', gameId);

    if (updateErr) { setError(updateErr.message); setSubmitting(false); return; }

    // Log submission event
    const { error: eventErr } = await supabase
      .from('game_submission_events')
      .insert({
        game_id: gameId,
        stage: 'build',
        action: isResubmit ? 'resubmitted' : 'submitted',
        actor_id: user.id,
        developer_notes: notes.trim() || null,
        attachments: [],
      });

    if (eventErr) { setError(eventErr.message); setSubmitting(false); return; }

    router.refresh();
  }

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-4">
      <div>
        <h2 className="font-semibold">
          {isResubmit ? 'Resubmit your build' : 'Submit your build'}
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          {isResubmit
            ? 'Address Roxy\'s feedback and resubmit your updated build.'
            : 'Your pitch has been approved. Submit your game URL for Roxy to test.'}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="game-url">
            Game URL <span className="text-destructive">*</span>
          </label>
          <input
            id="game-url"
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://your-game.com"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
          />
          <p className="text-xs text-muted-foreground">Must be an https:// URL. The game must be publicly accessible.</p>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="build-notes">
            Version notes <span className="text-muted-foreground font-normal">(optional)</span>
          </label>
          <textarea
            id="build-notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What's in this version? Any known issues or things to test?"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none"
          />
        </div>

        {error && (
          <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {submitting ? 'Submitting…' : isResubmit ? 'Resubmit build' : 'Submit build'}
        </button>
      </form>
    </div>
  );
}

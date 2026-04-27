'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import type { GameCategory } from '@/lib/games';

const CATEGORIES: { value: GameCategory; label: string }[] = [
  { value: 'party', label: 'Party' },
  { value: 'trivia', label: 'Trivia' },
  { value: 'dating', label: 'Dating' },
  { value: 'icebreaker', label: 'Icebreaker' },
  { value: 'other', label: 'Other' },
];

export default function PitchSubmitPage() {
  const router = useRouter();
  const supabase = createClient();

  const [form, setForm] = useState({
    name: '',
    short_description: '',
    how_it_works: '',
    why_wlw: '',
    category: 'party' as GameCategory,
    developer_notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('You must be logged in.'); setSubmitting(false); return; }

    // Insert game row
    const { data: game, error: gameErr } = await supabase
      .from('games')
      .insert({
        name: form.name.trim(),
        short_description: form.short_description.trim(),
        how_it_works: form.how_it_works.trim(),
        why_wlw: form.why_wlw.trim(),
        category: form.category,
        publisher_type: 'community',
        status: 'pitch_pending',
        submitted_by: user.id,
      })
      .select('id')
      .single();

    if (gameErr || !game) {
      setError(gameErr?.message ?? 'Failed to submit pitch.');
      setSubmitting(false);
      return;
    }

    // Insert submission event
    const { error: eventErr } = await supabase
      .from('game_submission_events')
      .insert({
        game_id: game.id,
        stage: 'pitch',
        action: 'submitted',
        actor_id: user.id,
        developer_notes: form.developer_notes.trim() || null,
        attachments: [],
      });

    if (eventErr) {
      setError(eventErr.message);
      setSubmitting(false);
      return;
    }

    router.push('/games/submissions');
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Pitch Your Game</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Before you invest time building anything, pitch your idea to Roxy first.
        </p>
      </div>

      {/* Warning banner */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong>Read before submitting.</strong> Pitches are not auto-approved.
        Roxy studies each submission carefully — approval unlocks the build stage.
        Rejected pitches will receive specific feedback in your submissions log.
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Game name */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="name">
            Game name <span className="text-destructive">*</span>
          </label>
          <input
            id="name"
            required
            minLength={2}
            maxLength={80}
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. WLW Trivia Night"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
          />
        </div>

        {/* Category */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="category">
            Category <span className="text-destructive">*</span>
          </label>
          <select
            id="category"
            value={form.category}
            onChange={(e) => set('category', e.target.value)}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>

        {/* Short description */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="short_description">
            Short description <span className="text-destructive">*</span>
          </label>
          <p className="text-xs text-muted-foreground">One sentence players will see in the game catalog (10–300 characters).</p>
          <textarea
            id="short_description"
            required
            minLength={10}
            maxLength={300}
            rows={2}
            value={form.short_description}
            onChange={(e) => set('short_description', e.target.value)}
            placeholder="e.g. A fast-paced trivia game with WLW pop culture questions."
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none"
          />
        </div>

        {/* How it works */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="how_it_works">
            How it works <span className="text-destructive">*</span>
          </label>
          <p className="text-xs text-muted-foreground">Describe the full game mechanics in detail (20–2000 characters).</p>
          <textarea
            id="how_it_works"
            required
            minLength={20}
            maxLength={2000}
            rows={6}
            value={form.how_it_works}
            onChange={(e) => set('how_it_works', e.target.value)}
            placeholder="Players are shown a question... teams compete... scoring works like..."
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none"
          />
        </div>

        {/* Why WLW */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="why_wlw">
            Why it fits the WLW community <span className="text-destructive">*</span>
          </label>
          <p className="text-xs text-muted-foreground">Explain why this game is a good fit for WLW spaces specifically (10–1000 characters).</p>
          <textarea
            id="why_wlw"
            required
            minLength={10}
            maxLength={1000}
            rows={4}
            value={form.why_wlw}
            onChange={(e) => set('why_wlw', e.target.value)}
            placeholder="This game works because..."
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none"
          />
        </div>

        {/* Developer notes (optional) */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="developer_notes">
            Notes to Roxy <span className="text-muted-foreground font-normal">(optional)</span>
          </label>
          <textarea
            id="developer_notes"
            rows={3}
            value={form.developer_notes}
            onChange={(e) => set('developer_notes', e.target.value)}
            placeholder="Anything else you want Roxy to know? Links to mockups, inspiration, prior work..."
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none"
          />
        </div>

        {error && (
          <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit pitch'}
          </button>
          <Link
            href="/games/submissions"
            className="rounded-lg border border-input px-6 py-2.5 text-sm font-semibold hover:bg-muted"
          >
            My submissions
          </Link>
        </div>
      </form>
    </div>
  );
}

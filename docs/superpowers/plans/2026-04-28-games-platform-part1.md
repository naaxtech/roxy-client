# Games Platform — Implementation Plan Part 1: DB + Studio

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the full two-stage pitch-then-build submission pipeline in Roxy Studio, plus the staff review queue and community game selector.

**Prerequisite:** Read `docs/superpowers/specs/2026-04-28-games-platform-design.md` first.

**Architecture:** New migration adds `games`, `game_submission_events`, `community_games` tables + `is_staff` on profiles. Studio gets six new pages. Staff pages are gated by `is_staff`. All state flows through Supabase — no separate API layer.

**Tech Stack:** Next.js 16 App Router, Supabase SSR (@supabase/ssr), shadcn/ui, TypeScript strict, Supabase migrations

---

## File Map

**Create:**
- `supabase/migrations/046_games.sql`
- `apps/studio/lib/games.ts` — typed DB helpers
- `apps/studio/app/(dashboard)/games/page.tsx` — community game selector
- `apps/studio/app/(dashboard)/games/submit/page.tsx` — pitch form
- `apps/studio/app/(dashboard)/games/submissions/page.tsx` — developer log
- `apps/studio/app/(dashboard)/games/submissions/[id]/page.tsx` — submission detail + build form
- `apps/studio/app/(dashboard)/staff/games/page.tsx` — staff review queue
- `apps/studio/app/(dashboard)/staff/games/[id]/page.tsx` — staff review detail

**Modify:**
- `apps/studio/app/(dashboard)/layout.tsx` — add Games nav item
- `apps/studio/app/(dashboard)/staff/layout.tsx` — create if not exists, staff guard

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/046_games.sql`

- [ ] **Step 1: Write migration**

```sql
-- supabase/migrations/046_games.sql

-- Add is_staff to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_staff boolean NOT NULL DEFAULT false;

-- Games catalog
CREATE TABLE public.games (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  short_description text NOT NULL CHECK (char_length(short_description) BETWEEN 10 AND 300),
  how_it_works      text NOT NULL CHECK (char_length(how_it_works) BETWEEN 20 AND 2000),
  why_wlw           text NOT NULL CHECK (char_length(why_wlw) BETWEEN 10 AND 1000),
  category          text NOT NULL CHECK (category IN ('party','trivia','dating','icebreaker','other')),
  publisher_type    text NOT NULL CHECK (publisher_type IN ('roxy','community')) DEFAULT 'community',
  status            text NOT NULL CHECK (status IN (
                      'pitch_pending','pitch_approved','pitch_rejected',
                      'build_pending','build_changes','live','suspended'
                    )) DEFAULT 'pitch_pending',
  url               text CHECK (url IS NULL OR url ~* '^https://'),
  thumbnail_url     text,
  submitted_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Submission events (audit log)
CREATE TABLE public.game_submission_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id           uuid NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  stage             text NOT NULL CHECK (stage IN ('pitch','build')),
  action            text NOT NULL CHECK (action IN (
                      'submitted','approved','rejected','changes_requested','resubmitted'
                    )),
  actor_id          uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  developer_notes   text,
  roxy_feedback     text,
  attachments       jsonb NOT NULL DEFAULT '[]',
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Community game selections
CREATE TABLE public.community_games (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  game_id      uuid NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  enabled_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  enabled_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (community_id, game_id)
);

-- Updated_at trigger for games
CREATE OR REPLACE FUNCTION public.set_games_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE TRIGGER games_updated_at
  BEFORE UPDATE ON public.games
  FOR EACH ROW EXECUTE FUNCTION public.set_games_updated_at();

-- RLS
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_submission_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_games ENABLE ROW LEVEL SECURITY;

-- games policies
CREATE POLICY "Live games are public"
  ON public.games FOR SELECT
  USING (status = 'live');

CREATE POLICY "Owners see their own games"
  ON public.games FOR SELECT
  USING (submitted_by = auth.uid());

CREATE POLICY "Staff see all games"
  ON public.games FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_staff = true)
  );

CREATE POLICY "Authenticated users can submit games"
  ON public.games FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND submitted_by = auth.uid());

CREATE POLICY "Owners can update draft fields"
  ON public.games FOR UPDATE
  USING (submitted_by = auth.uid() AND status IN ('pitch_approved','build_changes'));

CREATE POLICY "Staff can update status"
  ON public.games FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_staff = true)
  );

-- game_submission_events policies
CREATE POLICY "Owners see their game events"
  ON public.game_submission_events FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.games WHERE id = game_id AND submitted_by = auth.uid())
  );

CREATE POLICY "Staff see all events"
  ON public.game_submission_events FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_staff = true)
  );

CREATE POLICY "Authenticated users can insert events"
  ON public.game_submission_events FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- community_games policies
CREATE POLICY "Community members can view enabled games"
  ON public.community_games FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.community_members
      WHERE community_id = community_games.community_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Community admins can enable games"
  ON public.community_games FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.community_members
      WHERE community_id = community_games.community_id
        AND user_id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Community admins can disable games"
  ON public.community_games FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.community_members
      WHERE community_id = community_games.community_id
        AND user_id = auth.uid() AND role = 'admin'
    )
  );

-- Seed Roxy's own games
INSERT INTO public.games (name, short_description, how_it_works, why_wlw, category, publisher_type, status, url)
VALUES (
  'Speed Dating',
  '5-minute video speed dates. Match with someone new.',
  'Users join a queue. The system pairs them for a 5-minute video call via Daily.co. At the end, both can choose to match.',
  'Designed specifically for WLW connection in a safe, moderated environment.',
  'dating',
  'roxy',
  'live',
  NULL  -- native screen, no URL
);
```

- [ ] **Step 2: Apply migration**

```bash
cd D:/Nicole/Dev/roxy/roxy-client && npx supabase db push
```

Expected: migration applies cleanly, no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/046_games.sql
git commit -m "feat(games): migration 046 — games catalog, submission events, community_games, is_staff"
```

---

### Task 2: Studio Types + DB Helpers

**Files:**
- Create: `apps/studio/lib/games.ts`

- [ ] **Step 1: Write games.ts**

```ts
// apps/studio/lib/games.ts
import { createClient } from '@/lib/supabase/server';

export type GameStatus =
  | 'pitch_pending' | 'pitch_approved' | 'pitch_rejected'
  | 'build_pending' | 'build_changes' | 'live' | 'suspended';

export type GameCategory = 'party' | 'trivia' | 'dating' | 'icebreaker' | 'other';
export type PublisherType = 'roxy' | 'community';
export type SubmissionStage = 'pitch' | 'build';
export type SubmissionAction = 'submitted' | 'approved' | 'rejected' | 'changes_requested' | 'resubmitted';

export interface Game {
  id: string;
  name: string;
  short_description: string;
  how_it_works: string;
  why_wlw: string;
  category: GameCategory;
  publisher_type: PublisherType;
  status: GameStatus;
  url: string | null;
  thumbnail_url: string | null;
  submitted_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface GameSubmissionEvent {
  id: string;
  game_id: string;
  stage: SubmissionStage;
  action: SubmissionAction;
  actor_id: string | null;
  developer_notes: string | null;
  roxy_feedback: string | null;
  attachments: string[];
  created_at: string;
}

export interface CommunityGame {
  id: string;
  community_id: string;
  game_id: string;
  enabled_by: string | null;
  enabled_at: string;
}

// Fetch live games catalog
export async function getLiveGames(): Promise<Game[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('games')
    .select('*')
    .eq('status', 'live')
    .order('name');
  if (error) throw error;
  return data as Game[];
}

// Fetch community's enabled game IDs
export async function getCommunityGameIds(communityId: string): Promise<Set<string>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('community_games')
    .select('game_id')
    .eq('community_id', communityId);
  if (error) throw error;
  return new Set((data ?? []).map((r: any) => r.game_id));
}

// Fetch developer's own submissions
export async function getMySubmissions(userId: string): Promise<Game[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('games')
    .select('*')
    .eq('submitted_by', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as Game[];
}

// Fetch submission events for a game
export async function getSubmissionEvents(gameId: string): Promise<GameSubmissionEvent[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('game_submission_events')
    .select('*')
    .eq('game_id', gameId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data as GameSubmissionEvent[];
}

// Staff: fetch pending reviews
export async function getPendingReviews(): Promise<Game[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('games')
    .select('*, profiles(display_name)')
    .in('status', ['pitch_pending', 'build_pending', 'build_changes'])
    .order('updated_at', { ascending: true });
  if (error) throw error;
  return data as Game[];
}

// Status label helpers
export const STATUS_LABEL: Record<GameStatus, string> = {
  pitch_pending:   'Pitch Under Review',
  pitch_approved:  'Pitch Approved',
  pitch_rejected:  'Pitch Rejected',
  build_pending:   'Build Under Review',
  build_changes:   'Changes Requested',
  live:            'Live',
  suspended:       'Suspended',
};

export const STATUS_COLOR: Record<GameStatus, string> = {
  pitch_pending:  'text-yellow-500',
  pitch_approved: 'text-blue-500',
  pitch_rejected: 'text-red-500',
  build_pending:  'text-yellow-500',
  build_changes:  'text-orange-500',
  live:           'text-green-500',
  suspended:      'text-gray-400',
};

export function formatSubmittedAt(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const days = Math.floor((now.getTime() - date.getTime()) / 86400000);
  const dateStr = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  if (days === 0) return `${dateStr} · Today`;
  if (days === 1) return `${dateStr} · 1 day ago`;
  return `${dateStr} · ${days} days ago`;
}
```

- [ ] **Step 2: tsc check**

```bash
cd apps/studio && npx tsc --noEmit 2>&1 | grep "games.ts" | head -10
```

- [ ] **Step 3: Commit**

```bash
git add apps/studio/lib/games.ts
git commit -m "feat(games): Studio types + DB helpers — games, submission events, community_games"
```

---

### Task 3: Community Game Selector (`/games`)

**Files:**
- Create: `apps/studio/app/(dashboard)/games/page.tsx`

- [ ] **Step 1: Write page**

```tsx
// apps/studio/app/(dashboard)/games/page.tsx
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getLiveGames, getCommunityGameIds } from '@/lib/games';
import { GameSelectorClient } from './GameSelectorClient';

export default async function GamesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Get community for this host
  const { data: member } = await supabase
    .from('community_members')
    .select('community_id, role')
    .eq('user_id', user.id)
    .eq('role', 'admin')
    .limit(1)
    .single();

  if (!member) {
    return (
      <div className="p-8 text-muted-foreground">
        You need to be a community admin to manage games.
      </div>
    );
  }

  const [games, enabledIds] = await Promise.all([
    getLiveGames(),
    getCommunityGameIds(member.community_id),
  ]);

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Games</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Choose which games your community can play.
          </p>
        </div>
        <a href="/games/submit"
          className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-semibold hover:opacity-90">
          + Submit a Game Idea
        </a>
      </div>
      <GameSelectorClient
        games={games}
        enabledIds={[...enabledIds]}
        communityId={member.community_id}
        userId={user.id}
      />
    </div>
  );
}
```

- [ ] **Step 2: Write GameSelectorClient**

```tsx
// apps/studio/app/(dashboard)/games/GameSelectorClient.tsx
'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Game } from '@/lib/games';

export function GameSelectorClient({
  games, enabledIds, communityId, userId,
}: {
  games: Game[];
  enabledIds: string[];
  communityId: string;
  userId: string;
}) {
  const supabase = createClient();
  const [enabled, setEnabled] = useState<Set<string>>(new Set(enabledIds));
  const [loading, setLoading] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'roxy' | 'community'>('all');

  const filtered = filter === 'all' ? games : games.filter(g => g.publisher_type === filter);

  const toggle = async (game: Game) => {
    setLoading(game.id);
    const isEnabled = enabled.has(game.id);
    if (isEnabled) {
      await supabase.from('community_games')
        .delete()
        .eq('community_id', communityId)
        .eq('game_id', game.id);
      setEnabled(s => { const n = new Set(s); n.delete(game.id); return n; });
    } else {
      await supabase.from('community_games')
        .insert({ community_id: communityId, game_id: game.id, enabled_by: userId });
      setEnabled(s => new Set([...s, game.id]));
    }
    setLoading(null);
  };

  return (
    <div>
      {/* Filter tabs */}
      <div className="flex gap-2 mb-6">
        {(['all','roxy','community'] as const).map(f => (
          <button key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors
              ${filter === f
                ? 'bg-primary text-white'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>
            {f === 'all' ? 'All' : f === 'roxy' ? 'By Roxy' : 'Community'}
          </button>
        ))}
      </div>

      {/* Game grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {filtered.map(game => {
          const isEnabled = enabled.has(game.id);
          const isLoading = loading === game.id;
          return (
            <div key={game.id}
              className="bg-card border rounded-xl p-4 flex flex-col gap-3">
              {/* Thumbnail */}
              <div className="aspect-video bg-muted rounded-lg overflow-hidden">
                {game.thumbnail_url
                  ? <img src={game.thumbnail_url} alt={game.name} className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-3xl">🎮</div>
                }
              </div>
              {/* Name + badge */}
              <div>
                <p className="font-semibold text-sm">{game.name}</p>
                <span className={`text-xs font-medium ${game.publisher_type === 'roxy' ? 'text-purple-500' : 'text-blue-500'}`}>
                  {game.publisher_type === 'roxy' ? '🟣 By Roxy' : '👤 Community'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2">{game.short_description}</p>
              {/* Toggle */}
              <button
                onClick={() => toggle(game)}
                disabled={isLoading}
                className={`mt-auto w-full py-2 rounded-lg text-sm font-semibold transition-colors
                  ${isEnabled
                    ? 'bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20'
                    : 'bg-primary text-white hover:opacity-90'
                  } disabled:opacity-50`}>
                {isLoading ? '...' : isEnabled ? 'Enabled ✓' : 'Enable'}
              </button>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <p className="text-center text-muted-foreground py-16">No games found.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: tsc check**

```bash
cd apps/studio && npx tsc --noEmit 2>&1 | grep "games/page\|GameSelector" | head -10
```

- [ ] **Step 4: Commit**

```bash
git add "apps/studio/app/(dashboard)/games/"
git commit -m "feat(games): community game selector — browse live catalog, enable/disable per community"
```

---

### Task 4: Pitch Submission Form (`/games/submit`)

**Files:**
- Create: `apps/studio/app/(dashboard)/games/submit/page.tsx`

- [ ] **Step 1: Write page**

```tsx
// apps/studio/app/(dashboard)/games/submit/page.tsx
'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import type { GameCategory } from '@/lib/games';

const CATEGORIES: { value: GameCategory; label: string }[] = [
  { value: 'party',      label: 'Party' },
  { value: 'trivia',     label: 'Trivia' },
  { value: 'dating',     label: 'Dating' },
  { value: 'icebreaker', label: 'Icebreaker' },
  { value: 'other',      label: 'Other' },
];

export default function SubmitGamePage() {
  const supabase = createClient();
  const router = useRouter();

  const [form, setForm] = useState({
    name: '', short_description: '', how_it_works: '', why_wlw: '',
    category: 'party' as GameCategory,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('Not logged in'); setSubmitting(false); return; }

    const { data: game, error: gameErr } = await supabase
      .from('games')
      .insert({
        ...form,
        publisher_type: 'community',
        status: 'pitch_pending',
        submitted_by: user.id,
      })
      .select('id')
      .single();

    if (gameErr || !game) { setError(gameErr?.message ?? 'Failed to submit'); setSubmitting(false); return; }

    await supabase.from('game_submission_events').insert({
      game_id: game.id,
      stage: 'pitch',
      action: 'submitted',
      actor_id: user.id,
    });

    router.push('/games/submissions');
  };

  return (
    <div className="p-8 max-w-2xl">
      <a href="/games/submissions" className="text-sm text-muted-foreground hover:text-foreground mb-6 block">
        ← My Submissions
      </a>

      <h1 className="text-2xl font-bold mb-2">Submit a Game Idea</h1>

      {/* Warning banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-8 text-sm text-amber-800">
        <p className="font-semibold mb-1">Before you start building, pitch your idea first.</p>
        <p>
          We review every submission carefully — approval is not automatic.
          Submit your concept, mechanics, and any mockups here.
          If your pitch is approved, you'll be invited to submit the actual build.
          This protects your time and ensures the game fits the Roxy community.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div>
          <label className="block text-sm font-semibold mb-1">Game name</label>
          <input required value={form.name} onChange={set('name')}
            maxLength={80} className="w-full border rounded-lg px-3 py-2 text-sm"
            placeholder="e.g. WLW Trivia Night" />
        </div>

        <div>
          <label className="block text-sm font-semibold mb-1">What is it? <span className="font-normal text-muted-foreground">(1–2 sentences)</span></label>
          <textarea required value={form.short_description} onChange={set('short_description')}
            maxLength={300} rows={2} className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
            placeholder="A quick trivia game for WLW communities…" />
        </div>

        <div>
          <label className="block text-sm font-semibold mb-1">How does it work? <span className="font-normal text-muted-foreground">(mechanics)</span></label>
          <textarea required value={form.how_it_works} onChange={set('how_it_works')}
            maxLength={2000} rows={5} className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
            placeholder="Players are shown a question and 4 options. They have 15 seconds to answer…" />
        </div>

        <div>
          <label className="block text-sm font-semibold mb-1">Why is it right for WLW spaces?</label>
          <textarea required value={form.why_wlw} onChange={set('why_wlw')}
            maxLength={1000} rows={3} className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
            placeholder="All questions are curated for queer women's culture and shared experiences…" />
        </div>

        <div>
          <label className="block text-sm font-semibold mb-1">Category</label>
          <select value={form.category} onChange={set('category')}
            className="border rounded-lg px-3 py-2 text-sm w-40">
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={() => router.back()}
            className="px-6 py-2 rounded-lg border text-sm font-medium">
            Cancel
          </button>
          <button type="submit" disabled={submitting}
            className="px-6 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50">
            {submitting ? 'Submitting…' : 'Submit Pitch →'}
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: tsc check**

```bash
cd apps/studio && npx tsc --noEmit 2>&1 | grep "submit/page" | head -10
```

- [ ] **Step 3: Commit**

```bash
git add "apps/studio/app/(dashboard)/games/submit/"
git commit -m "feat(games): pitch submission form — two-stage warning, structured fields, audit event"
```

---

### Task 5: Developer Submissions Log (`/games/submissions`)

**Files:**
- Create: `apps/studio/app/(dashboard)/games/submissions/page.tsx`

- [ ] **Step 1: Write page**

```tsx
// apps/studio/app/(dashboard)/games/submissions/page.tsx
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getMySubmissions, STATUS_LABEL, STATUS_COLOR, formatSubmittedAt } from '@/lib/games';
import type { Game, GameStatus } from '@/lib/games';
import Link from 'next/link';

const STAGES: GameStatus[] = ['pitch_pending','pitch_approved','build_pending','build_changes','live'];

function ProgressDots({ status }: { status: GameStatus }) {
  const steps = [
    { key: 'pitch',        label: 'Pitch',        active: ['pitch_pending','pitch_approved','build_pending','build_changes','live'] },
    { key: 'pitch_ok',     label: 'Pitch Approved', active: ['pitch_approved','build_pending','build_changes','live'] },
    { key: 'build',        label: 'Build',        active: ['build_pending','build_changes','live'] },
    { key: 'live',         label: 'Live',         active: ['live'] },
  ];
  return (
    <div className="flex items-center gap-1 mt-2">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-1">
          <div className={`w-2 h-2 rounded-full ${(s.active as string[]).includes(status) ? 'bg-primary' : 'bg-muted'}`} />
          {i < steps.length - 1 && <div className="w-6 h-px bg-muted" />}
        </div>
      ))}
    </div>
  );
}

export default async function SubmissionsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const submissions = await getMySubmissions(user.id);

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">My Submissions</h1>
        <Link href="/games/submit"
          className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-semibold hover:opacity-90">
          + New Pitch
        </Link>
      </div>

      {submissions.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <p className="text-4xl mb-4">🎮</p>
          <p className="font-semibold text-foreground mb-1">No submissions yet</p>
          <p className="text-sm">Pitch your game idea and we'll review it.</p>
          <Link href="/games/submit"
            className="inline-block mt-4 bg-primary text-white px-6 py-2 rounded-lg text-sm font-semibold">
            Submit a Pitch
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {submissions.map(game => (
            <Link key={game.id} href={`/games/submissions/${game.id}`}
              className="block bg-card border rounded-xl p-5 hover:border-primary/40 transition-colors">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-base truncate">{game.name}</p>
                  <ProgressDots status={game.status} />
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <span className={`text-sm font-medium ${STATUS_COLOR[game.status]}`}>
                      {game.status === 'pitch_rejected' ? '❌' :
                       game.status === 'build_changes' ? '💬' :
                       game.status === 'live' ? '✅' : '⏳'} {STATUS_LABEL[game.status]}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatSubmittedAt(game.updated_at)}
                    </span>
                  </div>
                </div>
                <span className="text-muted-foreground text-lg flex-shrink-0">›</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: tsc check**

```bash
cd apps/studio && npx tsc --noEmit 2>&1 | grep "submissions/page" | head -10
```

- [ ] **Step 3: Commit**

```bash
git add "apps/studio/app/(dashboard)/games/submissions/"
git commit -m "feat(games): developer submissions log — progress dots, status badges, date + days ago"
```

---

### Task 6: Submission Detail + Build Form (`/games/submissions/[id]`)

**Files:**
- Create: `apps/studio/app/(dashboard)/games/submissions/[id]/page.tsx`

- [ ] **Step 1: Write page**

```tsx
// apps/studio/app/(dashboard)/games/submissions/[id]/page.tsx
import { createClient } from '@/lib/supabase/server';
import { redirect, notFound } from 'next/navigation';
import { getSubmissionEvents, STATUS_LABEL, STATUS_COLOR, formatSubmittedAt } from '@/lib/games';
import { BuildSubmitForm } from './BuildSubmitForm';
import type { Game } from '@/lib/games';

export default async function SubmissionDetailPage({ params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: game, error } = await supabase
    .from('games')
    .select('*')
    .eq('id', params.id)
    .eq('submitted_by', user.id)
    .single();

  if (error || !game) notFound();

  const events = await getSubmissionEvents(params.id);
  const latestFeedback = [...events].reverse().find(e => e.roxy_feedback)?.roxy_feedback ?? null;

  return (
    <div className="p-8 max-w-2xl">
      <a href="/games/submissions" className="text-sm text-muted-foreground hover:text-foreground mb-6 block">
        ← My Submissions
      </a>

      <h1 className="text-2xl font-bold mb-1">{game.name}</h1>
      <span className={`text-sm font-medium ${STATUS_COLOR[game.status as any]}`}>
        {STATUS_LABEL[game.status as any]}
      </span>

      {/* Roxy feedback banner */}
      {latestFeedback && (
        <div className="mt-4 bg-orange-50 border border-orange-200 rounded-xl p-4 text-sm text-orange-800">
          <p className="font-semibold mb-1">Feedback from Roxy</p>
          <p>{latestFeedback}</p>
        </div>
      )}

      {/* Build submission CTA */}
      {(game.status === 'pitch_approved' || game.status === 'build_changes') && (
        <div className="mt-6 bg-card border rounded-xl p-5">
          <p className="font-semibold mb-1">
            {game.status === 'pitch_approved' ? '✅ Pitch approved — submit your build' : '💬 Address feedback and resubmit'}
          </p>
          <p className="text-sm text-muted-foreground mb-4">
            Your game must work in a mobile WebView. Test it on mobile before submitting.
          </p>
          <BuildSubmitForm gameId={game.id} userId={user.id} isResubmit={game.status === 'build_changes'} />
        </div>
      )}

      {/* Event timeline */}
      <div className="mt-8">
        <h2 className="font-semibold mb-4">Submission History</h2>
        <div className="flex flex-col gap-3">
          {events.map(ev => (
            <div key={ev.id} className="flex gap-3 text-sm">
              <div className="flex flex-col items-center">
                <div className="w-2 h-2 rounded-full bg-primary mt-1.5 flex-shrink-0" />
                <div className="w-px flex-1 bg-muted mt-1" />
              </div>
              <div className="pb-3 flex-1">
                <div className="flex flex-wrap gap-2 items-center">
                  <span className="font-medium capitalize">{ev.stage} {ev.action.replace('_', ' ')}</span>
                  <span className="text-xs text-muted-foreground">{formatSubmittedAt(ev.created_at)}</span>
                </div>
                {ev.developer_notes && (
                  <p className="text-muted-foreground mt-1">Your notes: {ev.developer_notes}</p>
                )}
                {ev.roxy_feedback && (
                  <p className="text-orange-600 mt-1">Roxy: "{ev.roxy_feedback}"</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write BuildSubmitForm**

```tsx
// apps/studio/app/(dashboard)/games/submissions/[id]/BuildSubmitForm.tsx
'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

export function BuildSubmitForm({
  gameId, userId, isResubmit,
}: {
  gameId: string; userId: string; isResubmit: boolean;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.startsWith('https://')) { setError('URL must start with https://'); return; }
    setSubmitting(true);
    setError(null);

    const { error: updateErr } = await supabase
      .from('games')
      .update({ url, status: 'build_pending' })
      .eq('id', gameId);

    if (updateErr) { setError(updateErr.message); setSubmitting(false); return; }

    await supabase.from('game_submission_events').insert({
      game_id: gameId,
      stage: 'build',
      action: isResubmit ? 'resubmitted' : 'submitted',
      actor_id: userId,
      developer_notes: notes || null,
    });

    router.refresh();
    setSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label className="block text-sm font-semibold mb-1">Game URL</label>
        <input required value={url} onChange={e => setUrl(e.target.value)}
          placeholder="https://yourgame.com"
          className="w-full border rounded-lg px-3 py-2 text-sm" />
        <p className="text-xs text-muted-foreground mt-1">Must work in a mobile WebView.</p>
      </div>
      <div>
        <label className="block text-sm font-semibold mb-1">Version notes <span className="font-normal text-muted-foreground">(optional)</span></label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)}
          rows={3} maxLength={1000}
          placeholder="What you built, any known limitations…"
          className="w-full border rounded-lg px-3 py-2 text-sm resize-none" />
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <button type="submit" disabled={submitting}
        className="self-start px-6 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50">
        {submitting ? 'Submitting…' : isResubmit ? 'Resubmit Build' : 'Submit Build for Review'}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: tsc check**

```bash
cd apps/studio && npx tsc --noEmit 2>&1 | grep "submissions/\[id\]" | head -10
```

- [ ] **Step 4: Commit**

```bash
git add "apps/studio/app/(dashboard)/games/submissions/[id]/"
git commit -m "feat(games): submission detail — event timeline, build submit form, resubmit flow"
```

---

### Task 7: Staff Review Queue (`/staff/games`)

**Files:**
- Create: `apps/studio/app/(dashboard)/staff/layout.tsx`
- Create: `apps/studio/app/(dashboard)/staff/games/page.tsx`

- [ ] **Step 1: Write staff layout (is_staff guard)**

```tsx
// apps/studio/app/(dashboard)/staff/layout.tsx
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_staff')
    .eq('id', user.id)
    .single();

  if (!profile?.is_staff) notFound();

  return <>{children}</>;
}

function notFound(): never {
  const { notFound } = require('next/navigation');
  notFound();
}
```

- [ ] **Step 2: Write staff review queue**

```tsx
// apps/studio/app/(dashboard)/staff/games/page.tsx
import { createClient } from '@/lib/supabase/server';
import { getPendingReviews, STATUS_LABEL, STATUS_COLOR, formatSubmittedAt } from '@/lib/games';
import Link from 'next/link';

export default async function StaffGamesPage() {
  const pending = await getPendingReviews();
  const pitches = pending.filter(g => g.status === 'pitch_pending');
  const builds  = pending.filter(g => ['build_pending','build_changes'].includes(g.status));

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">Review Queue</h1>

      {/* Pitches */}
      <section className="mb-8">
        <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground mb-3">
          Pitches ({pitches.length})
        </h2>
        {pitches.length === 0
          ? <p className="text-muted-foreground text-sm">No pitches pending.</p>
          : (
            <div className="flex flex-col gap-3">
              {pitches.map(g => (
                <Link key={g.id} href={`/staff/games/${g.id}`}
                  className="bg-card border rounded-xl px-5 py-4 flex items-center justify-between hover:border-primary/40 transition-colors">
                  <div>
                    <p className="font-semibold">{g.name}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {(g as any).profiles?.display_name ?? 'Unknown'} · {formatSubmittedAt(g.updated_at)}
                    </p>
                  </div>
                  <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded-full font-medium">Pitch</span>
                </Link>
              ))}
            </div>
          )
        }
      </section>

      {/* Builds */}
      <section>
        <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground mb-3">
          Builds ({builds.length})
        </h2>
        {builds.length === 0
          ? <p className="text-muted-foreground text-sm">No builds pending.</p>
          : (
            <div className="flex flex-col gap-3">
              {builds.map(g => (
                <Link key={g.id} href={`/staff/games/${g.id}`}
                  className="bg-card border rounded-xl px-5 py-4 flex items-center justify-between hover:border-primary/40 transition-colors">
                  <div>
                    <p className="font-semibold">{g.name}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {(g as any).profiles?.display_name ?? 'Unknown'} · {formatSubmittedAt(g.updated_at)}
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium
                    ${g.status === 'build_changes' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                    {g.status === 'build_changes' ? 'Resubmitted' : 'Build'}
                  </span>
                </Link>
              ))}
            </div>
          )
        }
      </section>
    </div>
  );
}
```

- [ ] **Step 3: tsc check**

```bash
cd apps/studio && npx tsc --noEmit 2>&1 | grep "staff/games" | head -10
```

- [ ] **Step 4: Commit**

```bash
git add "apps/studio/app/(dashboard)/staff/"
git commit -m "feat(games): staff review queue — pitch/build tabs, date + days ago, is_staff guard"
```

---

### Task 8: Staff Review Detail (`/staff/games/[id]`)

**Files:**
- Create: `apps/studio/app/(dashboard)/staff/games/[id]/page.tsx`

- [ ] **Step 1: Write review detail page**

```tsx
// apps/studio/app/(dashboard)/staff/games/[id]/page.tsx
import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { getSubmissionEvents, formatSubmittedAt } from '@/lib/games';
import { StaffReviewForm } from './StaffReviewForm';

export default async function StaffGameReviewPage({ params }: { params: { id: string } }) {
  const supabase = await createClient();

  const { data: game, error } = await supabase
    .from('games')
    .select('*, profiles(display_name)')
    .eq('id', params.id)
    .single();

  if (error || !game) notFound();

  const events = await getSubmissionEvents(params.id);

  return (
    <div className="p-8 max-w-4xl">
      <a href="/staff/games" className="text-sm text-muted-foreground hover:text-foreground mb-6 block">
        ← Review Queue
      </a>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Left: game details */}
        <div>
          <h1 className="text-xl font-bold mb-1">{game.name}</h1>
          <p className="text-sm text-muted-foreground mb-4">
            by {(game as any).profiles?.display_name ?? 'Unknown'} · {formatSubmittedAt(game.updated_at)}
          </p>

          <div className="flex flex-col gap-4 text-sm">
            <div>
              <p className="font-semibold mb-1">What is it?</p>
              <p className="text-muted-foreground">{game.short_description}</p>
            </div>
            <div>
              <p className="font-semibold mb-1">How it works</p>
              <p className="text-muted-foreground whitespace-pre-wrap">{game.how_it_works}</p>
            </div>
            <div>
              <p className="font-semibold mb-1">Why WLW?</p>
              <p className="text-muted-foreground">{game.why_wlw}</p>
            </div>
            {game.url && (
              <div>
                <p className="font-semibold mb-1">Build URL</p>
                <a href={game.url} target="_blank" rel="noopener noreferrer"
                  className="text-primary underline break-all">{game.url} ↗</a>
              </div>
            )}
          </div>

          {/* Timeline */}
          <div className="mt-6">
            <p className="font-semibold text-sm mb-3">History</p>
            <div className="flex flex-col gap-2">
              {events.map(ev => (
                <div key={ev.id} className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground capitalize">{ev.stage} {ev.action.replace('_',' ')}</span>
                  {' · '}{formatSubmittedAt(ev.created_at)}
                  {ev.developer_notes && <p className="mt-0.5">Dev: {ev.developer_notes}</p>}
                  {ev.roxy_feedback && <p className="mt-0.5 text-orange-600">Roxy: {ev.roxy_feedback}</p>}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: review action */}
        <div className="bg-card border rounded-xl p-5 self-start">
          <p className="font-semibold mb-4">Review Decision</p>
          <StaffReviewForm game={game as any} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write StaffReviewForm**

```tsx
// apps/studio/app/(dashboard)/staff/games/[id]/StaffReviewForm.tsx
'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import type { Game, GameStatus } from '@/lib/games';

const NEXT_STATUS: Record<string, { approve: GameStatus; reject: GameStatus; changes?: GameStatus }> = {
  pitch_pending:  { approve: 'pitch_approved', reject: 'pitch_rejected' },
  build_pending:  { approve: 'live',           reject: 'pitch_approved', changes: 'build_changes' },
  build_changes:  { approve: 'live',           reject: 'pitch_approved', changes: 'build_changes' },
};

export function StaffReviewForm({ game }: { game: Game & { profiles: { display_name: string } | null } }) {
  const supabase = createClient();
  const router = useRouter();
  const [feedback, setFeedback] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const flow = NEXT_STATUS[game.status];
  if (!flow) return <p className="text-muted-foreground text-sm">No actions available for this status.</p>;

  const stage = game.status.startsWith('pitch') ? 'pitch' : 'build';

  const act = async (action: 'approve' | 'reject' | 'changes') => {
    setSubmitting(action);
    setError(null);

    const newStatus = action === 'approve' ? flow.approve
                    : action === 'changes' ? flow.changes!
                    : flow.reject;

    const { data: { user } } = await supabase.auth.getUser();

    await supabase.from('games').update({ status: newStatus }).eq('id', game.id);

    await supabase.from('game_submission_events').insert({
      game_id: game.id,
      stage,
      action: action === 'approve' ? 'approved' : action === 'changes' ? 'changes_requested' : 'rejected',
      actor_id: user?.id,
      roxy_feedback: feedback || null,
    });

    router.push('/staff/games');
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className="block text-sm font-semibold mb-1">Feedback to developer <span className="font-normal text-muted-foreground">(shown in their dashboard)</span></label>
        <textarea value={feedback} onChange={e => setFeedback(e.target.value)}
          rows={4} maxLength={2000}
          placeholder="Be specific about what needs to change, or why it was approved…"
          className="w-full border rounded-lg px-3 py-2 text-sm resize-none" />
      </div>

      <div>
        <label className="block text-sm font-semibold mb-1">Internal notes <span className="font-normal text-muted-foreground">(not shown to developer)</span></label>
        <textarea value={internalNotes} onChange={e => setInternalNotes(e.target.value)}
          rows={2} maxLength={1000}
          className="w-full border rounded-lg px-3 py-2 text-sm resize-none" />
      </div>

      {error && <p className="text-red-500 text-sm">{error}</p>}

      <div className="flex flex-col gap-2 pt-2">
        {flow.changes && (
          <button onClick={() => act('changes')} disabled={!!submitting}
            className="w-full py-2 rounded-lg border border-orange-300 bg-orange-50 text-orange-700 text-sm font-semibold disabled:opacity-50">
            {submitting === 'changes' ? '…' : '💬 Request Changes'}
          </button>
        )}
        <button onClick={() => act('reject')} disabled={!!submitting}
          className="w-full py-2 rounded-lg border border-red-300 bg-red-50 text-red-700 text-sm font-semibold disabled:opacity-50">
          {submitting === 'reject' ? '…' : '❌ Reject'}
        </button>
        <button onClick={() => act('approve')} disabled={!!submitting}
          className="w-full py-2 rounded-lg bg-green-600 text-white text-sm font-semibold disabled:opacity-50">
          {submitting === 'approve' ? '…' : '✓ Approve'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: tsc check**

```bash
cd apps/studio && npx tsc --noEmit 2>&1 | grep "staff/games/\[id\]" | head -10
```

- [ ] **Step 4: Commit**

```bash
git add "apps/studio/app/(dashboard)/staff/games/[id]/"
git commit -m "feat(games): staff review detail — pitch/build actions, feedback to dev, approve/reject/changes"
```

---

### Task 9: Nav + QA

**Files:**
- Modify: `apps/studio/app/(dashboard)/layout.tsx`

- [ ] **Step 1: Add Games to Studio nav**

Find the nav links array and add:
```tsx
{ href: '/games',             label: 'Games',    icon: '🎮' },
{ href: '/games/submissions', label: 'My Games', icon: '📋' },
```
Staff-only nav item (conditionally rendered if `is_staff`):
```tsx
{ href: '/staff/games', label: 'Review Queue', icon: '⚙️' },
```

- [ ] **Step 2: Full tsc check**

```bash
cd apps/studio && npx tsc --noEmit 2>&1 | grep -v node_modules | head -20
```
Fix any errors.

- [ ] **Step 3: Create PR**

```bash
git add apps/studio/app/(dashboard)/layout.tsx
git commit -m "feat(games): add Games nav items to Studio sidebar"

git push -u origin session-14-games-studio
gh pr create --base main \
  --title "feat(games): Studio games platform — pitch/build pipeline, staff review, community selector" \
  --body "Two-stage game submission pipeline in Roxy Studio. Migration 046. See docs/superpowers/specs/2026-04-28-games-platform-design.md"
```

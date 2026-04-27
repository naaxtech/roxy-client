-- supabase/migrations/047_games_missing_objects.sql
-- The games table was partially created in a previous session with a different
-- schema (includes a slug column). This migration adds the missing columns,
-- creates the dependent tables, trigger, RLS policies, and fixes the seed row.

-- ── Add missing columns to games ──────────────────────────────────────────────

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS short_description text,
  ADD COLUMN IF NOT EXISTS how_it_works      text,
  ADD COLUMN IF NOT EXISTS why_wlw           text,
  ADD COLUMN IF NOT EXISTS category          text,
  ADD COLUMN IF NOT EXISTS publisher_type    text NOT NULL DEFAULT 'community',
  ADD COLUMN IF NOT EXISTS status            text NOT NULL DEFAULT 'pitch_pending',
  ADD COLUMN IF NOT EXISTS url               text,
  ADD COLUMN IF NOT EXISTS thumbnail_url     text,
  ADD COLUMN IF NOT EXISTS submitted_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at        timestamptz NOT NULL DEFAULT now();

-- Add CHECK constraints (safe — catches duplicate)
DO $$ BEGIN
  ALTER TABLE public.games ADD CONSTRAINT games_category_values
    CHECK (category IS NULL OR category IN ('party','trivia','dating','icebreaker','other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.games ADD CONSTRAINT games_publisher_type_values
    CHECK (publisher_type IN ('roxy','community'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.games ADD CONSTRAINT games_status_values
    CHECK (status IN (
      'pitch_pending','pitch_approved','pitch_rejected',
      'build_pending','build_changes','live','suspended'
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.games ADD CONSTRAINT games_url_https
    CHECK (url IS NULL OR url ~* '^https://');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Fix the existing Speed Dating row ────────────────────────────────────────
-- It already exists but has publisher_type defaulted to 'community' and status
-- defaulted to 'pitch_pending'. Set correct values.

UPDATE public.games
SET
  publisher_type    = 'roxy',
  status            = 'live',
  short_description = COALESCE(short_description, '5-minute video speed dates. Match with someone new.'),
  how_it_works      = COALESCE(how_it_works, 'Users join a queue. The system pairs them for a 5-minute video call. At the end, both can choose to match.'),
  why_wlw           = COALESCE(why_wlw, 'Designed specifically for WLW connection in a safe, moderated environment.'),
  category          = COALESCE(category, 'dating'),
  url               = NULL
WHERE name = 'Speed Dating';

-- ── game_submission_events ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.game_submission_events (
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

-- ── community_games ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.community_games (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  game_id      uuid NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  enabled_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  enabled_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (community_id, game_id)
);

-- ── updated_at trigger ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_games_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS games_updated_at ON public.games;
CREATE TRIGGER games_updated_at
  BEFORE UPDATE ON public.games
  FOR EACH ROW EXECUTE FUNCTION public.set_games_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_submission_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_games ENABLE ROW LEVEL SECURITY;

-- games
DO $$ BEGIN
  CREATE POLICY "Live games visible to authenticated users"
    ON public.games FOR SELECT TO authenticated USING (status = 'live');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Owners see own game submissions"
    ON public.games FOR SELECT TO authenticated USING (submitted_by = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Staff see all games"
    ON public.games FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_staff = true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated users can submit games"
    ON public.games FOR INSERT TO authenticated WITH CHECK (submitted_by = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Owners can update build fields"
    ON public.games FOR UPDATE TO authenticated
    USING (submitted_by = auth.uid() AND status IN ('pitch_approved','build_changes'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can update game status"
    ON public.games FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_staff = true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- game_submission_events
DO $$ BEGIN
  CREATE POLICY "Owners see their submission events"
    ON public.game_submission_events FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.games WHERE id = game_id AND submitted_by = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Staff see all submission events"
    ON public.game_submission_events FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_staff = true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated users can insert submission events"
    ON public.game_submission_events FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- community_games
DO $$ BEGIN
  CREATE POLICY "Community members can view enabled games"
    ON public.community_games FOR SELECT TO authenticated
    USING (EXISTS (
      SELECT 1 FROM public.community_members
      WHERE community_id = community_games.community_id AND user_id = auth.uid()
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Community admins can enable games"
    ON public.community_games FOR INSERT TO authenticated
    WITH CHECK (EXISTS (
      SELECT 1 FROM public.community_members
      WHERE community_id = community_games.community_id
        AND user_id = auth.uid()
        AND role IN ('admin','moderator')
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Community admins can disable games"
    ON public.community_games FOR DELETE TO authenticated
    USING (EXISTS (
      SELECT 1 FROM public.community_members
      WHERE community_id = community_games.community_id
        AND user_id = auth.uid()
        AND role IN ('admin','moderator')
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

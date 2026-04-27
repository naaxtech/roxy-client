-- supabase/migrations/046_games.sql
-- Games catalog + submission pipeline + community game selections

-- Games catalog
CREATE TABLE public.games (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  short_description text NOT NULL CHECK (char_length(short_description) BETWEEN 10 AND 300),
  how_it_works      text NOT NULL CHECK (char_length(how_it_works) BETWEEN 20 AND 2000),
  why_wlw           text NOT NULL CHECK (char_length(why_wlw) BETWEEN 10 AND 1000),
  category          text NOT NULL CHECK (category IN ('party','trivia','dating','icebreaker','other')),
  publisher_type    text NOT NULL DEFAULT 'community' CHECK (publisher_type IN ('roxy','community')),
  status            text NOT NULL DEFAULT 'pitch_pending' CHECK (status IN (
                      'pitch_pending','pitch_approved','pitch_rejected',
                      'build_pending','build_changes','live','suspended'
                    )),
  url               text CHECK (url IS NULL OR url ~* '^https://'),
  thumbnail_url     text,
  submitted_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Submission events (full audit log)
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

-- updated_at trigger
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

-- games: live games visible to all authenticated users
CREATE POLICY "Live games visible to authenticated users"
  ON public.games FOR SELECT
  TO authenticated
  USING (status = 'live');

-- games: owners see their own submissions
CREATE POLICY "Owners see own game submissions"
  ON public.games FOR SELECT
  TO authenticated
  USING (submitted_by = auth.uid());

-- games: staff see all
CREATE POLICY "Staff see all games"
  ON public.games FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_staff = true)
  );

-- games: authenticated users can submit
CREATE POLICY "Authenticated users can submit games"
  ON public.games FOR INSERT
  TO authenticated
  WITH CHECK (submitted_by = auth.uid());

-- games: owners can update URL/status during build stage
CREATE POLICY "Owners can update build fields"
  ON public.games FOR UPDATE
  TO authenticated
  USING (submitted_by = auth.uid() AND status IN ('pitch_approved','build_changes'));

-- games: staff can update status
CREATE POLICY "Staff can update game status"
  ON public.games FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_staff = true)
  );

-- game_submission_events: owners see their game events
CREATE POLICY "Owners see their submission events"
  ON public.game_submission_events FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.games WHERE id = game_id AND submitted_by = auth.uid())
  );

-- game_submission_events: staff see all
CREATE POLICY "Staff see all submission events"
  ON public.game_submission_events FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_staff = true)
  );

-- game_submission_events: authenticated users can insert
CREATE POLICY "Authenticated users can insert submission events"
  ON public.game_submission_events FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- community_games: community members can view
CREATE POLICY "Community members can view enabled games"
  ON public.community_games FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.community_members
      WHERE community_id = community_games.community_id AND user_id = auth.uid()
    )
  );

-- community_games: admins/moderators can enable
CREATE POLICY "Community admins can enable games"
  ON public.community_games FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.community_members
      WHERE community_id = community_games.community_id
        AND user_id = auth.uid()
        AND role IN ('admin','moderator')
    )
  );

-- community_games: admins/moderators can disable
CREATE POLICY "Community admins can disable games"
  ON public.community_games FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.community_members
      WHERE community_id = community_games.community_id
        AND user_id = auth.uid()
        AND role IN ('admin','moderator')
    )
  );

-- Seed Speed Dating (Roxy native game — no URL)
INSERT INTO public.games (
  name, short_description, how_it_works, why_wlw,
  category, publisher_type, status, url, submitted_by
) VALUES (
  'Speed Dating',
  '5-minute video speed dates. Match with someone new.',
  'Users join a queue. The system pairs them for a 5-minute video call. At the end, both can choose to match.',
  'Designed specifically for WLW connection in a safe, moderated environment.',
  'dating', 'roxy', 'live', NULL, NULL
);

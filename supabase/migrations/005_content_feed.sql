-- supabase/migrations/005_content_feed.sql

-- POSTS
CREATE TABLE public.posts (
  id             uuid       PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id      uuid       NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  community_id   uuid       REFERENCES public.communities(id) ON DELETE CASCADE,
  content        text       NOT NULL,
  media_urls     text[]     NOT NULL DEFAULT '{}',
  post_type      text       NOT NULL DEFAULT 'standard'
                            CHECK (post_type IN ('standard','event','poll','resource')),
  is_pinned      boolean    NOT NULL DEFAULT false,
  is_flagged     boolean    NOT NULL DEFAULT false,
  reaction_counts jsonb     NOT NULL DEFAULT '{}',
  comment_count  integer    NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- EVENTS
CREATE TABLE public.events (
  id             uuid       PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id   uuid       REFERENCES public.communities(id) ON DELETE SET NULL,
  host_id        uuid       NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title          text       NOT NULL,
  description    text,
  event_type     text       NOT NULL DEFAULT 'online'
                            CHECK (event_type IN ('online','in_person','hybrid')),
  starts_at      timestamptz NOT NULL,
  ends_at        timestamptz,
  location_text  text,
  location_url   text,
  max_attendees  integer,
  attendee_count integer    NOT NULL DEFAULT 0,
  cover_image_url text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- EVENT ATTENDEES
CREATE TABLE public.event_attendees (
  event_id  uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rsvp_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);

-- RLS
ALTER TABLE public.posts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_attendees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "posts_select"   ON public.posts FOR SELECT TO authenticated USING (true);
CREATE POLICY "posts_insert"   ON public.posts FOR INSERT TO authenticated WITH CHECK (author_id = auth.uid());
CREATE POLICY "posts_update"   ON public.posts FOR UPDATE TO authenticated USING (author_id = auth.uid());
CREATE POLICY "posts_delete"   ON public.posts FOR DELETE TO authenticated USING (author_id = auth.uid());

CREATE POLICY "events_select"  ON public.events FOR SELECT TO authenticated USING (true);
CREATE POLICY "events_insert"  ON public.events FOR INSERT TO authenticated WITH CHECK (host_id = auth.uid());
CREATE POLICY "events_update"  ON public.events FOR UPDATE TO authenticated USING (host_id = auth.uid());

CREATE POLICY "ea_select" ON public.event_attendees FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "ea_insert" ON public.event_attendees FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "ea_delete" ON public.event_attendees FOR DELETE TO authenticated USING (user_id = auth.uid());

-- TRIGGER: sync attendee_count on event_attendees INSERT/DELETE
CREATE OR REPLACE FUNCTION public.update_attendee_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.events SET attendee_count = attendee_count + 1 WHERE id = NEW.event_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.events SET attendee_count = GREATEST(0, attendee_count - 1) WHERE id = OLD.event_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_attendee_count
  AFTER INSERT OR DELETE ON public.event_attendees
  FOR EACH ROW EXECUTE FUNCTION public.update_attendee_count();

-- INDEXES
CREATE INDEX idx_posts_community  ON public.posts(community_id);
CREATE INDEX idx_posts_author     ON public.posts(author_id);
CREATE INDEX idx_posts_created    ON public.posts(created_at DESC);
CREATE INDEX idx_events_starts_at ON public.events(starts_at);
CREATE INDEX idx_events_community ON public.events(community_id);

-- SEED (uses first profile; harmless if no profiles exist)
DO $$
DECLARE v_host uuid;
BEGIN
  SELECT id INTO v_host FROM public.profiles LIMIT 1;
  IF v_host IS NOT NULL THEN
    INSERT INTO public.events (host_id, title, description, event_type, starts_at)
    VALUES
      (v_host, 'Queer Book Club', 'Monthly book club for queer women and allies',
       'online', now() + interval '3 days'),
      (v_host, 'WLW Social Mixer', 'Casual meetup for women who love women',
       'in_person', now() + interval '7 days');
  END IF;
END $$;

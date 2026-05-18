-- Profile showcase photos (up to 6) and saved Roxy events/games

CREATE TABLE public.profile_photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  photo_url   text NOT NULL,
  sort_order  int NOT NULL DEFAULT 0 CHECK (sort_order >= 0 AND sort_order < 6),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, sort_order)
);

CREATE TABLE public.user_favorites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('event', 'game')),
  entity_id   uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, entity_type, entity_id)
);

ALTER TABLE public.profile_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profile_photos_select" ON public.profile_photos
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "profile_photos_own_write" ON public.profile_photos
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_favorites_select" ON public.user_favorites
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "user_favorites_own_write" ON public.user_favorites
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX idx_profile_photos_user ON public.profile_photos (user_id, sort_order);
CREATE INDEX idx_user_favorites_user ON public.user_favorites (user_id, entity_type);

-- supabase/migrations/003_communities_social.sql

-- ─── communities ─────────────────────────────────────────────────────────────
CREATE TABLE communities (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name            text NOT NULL,
  slug            text UNIQUE NOT NULL,
  description     text,
  cover_image_url text,
  category        text CHECK (category IN ('identity','interest','location','support')) NOT NULL,
  is_private      boolean DEFAULT false,
  member_count    int DEFAULT 0,
  created_by      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE communities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "communities_read_public" ON communities
  FOR SELECT USING (is_private = false);

CREATE POLICY "communities_insert_auth" ON communities
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "communities_update_own" ON communities
  FOR UPDATE USING (auth.uid() = created_by);

CREATE INDEX idx_communities_category ON communities (category);
CREATE INDEX idx_communities_slug ON communities (slug);

-- ─── community_members ───────────────────────────────────────────────────────
CREATE TABLE community_members (
  community_id uuid REFERENCES communities(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES profiles(id) ON DELETE CASCADE,
  role         text DEFAULT 'member' CHECK (role IN ('member','moderator','admin')),
  joined_at    timestamptz DEFAULT now(),
  PRIMARY KEY (community_id, user_id)
);

ALTER TABLE community_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cm_read_own" ON community_members
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "cm_read_community_member" ON community_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM community_members cm2
      WHERE cm2.community_id = community_members.community_id
        AND cm2.user_id = auth.uid()
    )
  );

CREATE POLICY "cm_insert_own" ON community_members
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "cm_delete_own" ON community_members
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_cm_user ON community_members (user_id);
CREATE INDEX idx_cm_community ON community_members (community_id);

-- Trigger: auto increment/decrement member_count
CREATE OR REPLACE FUNCTION update_member_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE communities SET member_count = member_count + 1 WHERE id = NEW.community_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE communities SET member_count = GREATEST(member_count - 1, 0) WHERE id = OLD.community_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER community_member_count
  AFTER INSERT OR DELETE ON community_members
  FOR EACH ROW EXECUTE FUNCTION update_member_count();

-- ─── friendships ─────────────────────────────────────────────────────────────
CREATE TABLE friendships (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  requester_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  addressee_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  status       text DEFAULT 'pending' CHECK (status IN ('pending','accepted','blocked')),
  created_at   timestamptz DEFAULT now(),
  UNIQUE (requester_id, addressee_id),
  CONSTRAINT no_self_friendship CHECK (requester_id != addressee_id)
);

ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "friendships_own" ON friendships
  FOR ALL USING (auth.uid() IN (requester_id, addressee_id));

CREATE INDEX idx_friendships_addressee ON friendships (addressee_id, status);
CREATE INDEX idx_friendships_requester ON friendships (requester_id, status);

-- Seed: 5 starter communities
INSERT INTO communities (name, slug, description, category) VALUES
  ('Lesbians of London',       'lesbians-of-london',       'London''s lesbian community hub',                    'location'),
  ('Bi+ Collective',           'bi-collective',            'Bisexual, pansexual & fluid women connecting',       'identity'),
  ('Queer Gamers',             'queer-gamers',             'WLW gamers unite — all platforms welcome',           'interest'),
  ('WLW Entrepreneurs',        'wlw-entrepreneurs',        'Building businesses and supporting each other',      'interest'),
  ('Trans & Non-binary Support','trans-nb-support',        'Safe space for trans and non-binary WLW',            'support');

-- ─── profiles ────────────────────────────────────────────────────────────────
-- Extends auth.users. One row per authenticated user.
CREATE TABLE profiles (
  id                       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username                 text UNIQUE NOT NULL,
  display_name             text NOT NULL,
  bio                      text,
  avatar_url               text,
  pronouns                 text[] DEFAULT '{}',
  identity_labels          text[] DEFAULT '{}',
  is_dating_mode           boolean DEFAULT false,
  dating_looking_for       text[] DEFAULT '{}',
  age_min_pref             int DEFAULT 18,
  age_max_pref             int DEFAULT 99,
  location_city            text,
  location_country         text,
  is_verified              boolean DEFAULT false,
  is_active                boolean DEFAULT true,
  last_seen_at             timestamptz DEFAULT now(),
  gamification_points      int DEFAULT 0,
  badge_ids                uuid[] DEFAULT '{}',
  push_token               text,
  notification_preferences jsonb DEFAULT '{}',
  is_ghost                 boolean DEFAULT false,
  created_at               timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Anyone can read non-ghost, active profiles
CREATE POLICY "profiles_select_public" ON profiles
  FOR SELECT USING (is_active = true AND is_ghost = false);

-- Users can always read their own profile (even if ghost/inactive)
CREATE POLICY "profiles_select_own" ON profiles
  FOR SELECT USING (auth.uid() = id);

-- Users can only insert their own profile row
CREATE POLICY "profiles_insert_own" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Users can only update their own profile
CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE INDEX idx_profiles_username ON profiles (username);
CREATE INDEX idx_profiles_dating_mode ON profiles (is_dating_mode) WHERE is_dating_mode = true;
CREATE INDEX idx_profiles_last_seen ON profiles (last_seen_at DESC);

-- Auto-update updated_at on every profile change
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── roxy_greetings ──────────────────────────────────────────────────────────
-- One greeting per user per calendar day (UNIQUE constraint enforces cache rule)
CREATE TABLE roxy_greetings (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id        uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  greeting_text  text NOT NULL,
  context_data   jsonb,
  generated_date date DEFAULT CURRENT_DATE,
  was_opened     boolean DEFAULT false,
  UNIQUE (user_id, generated_date)
);

ALTER TABLE roxy_greetings ENABLE ROW LEVEL SECURITY;

-- Users can only read and write their own greetings
CREATE POLICY "greetings_own" ON roxy_greetings
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX idx_greetings_user_date ON roxy_greetings (user_id, generated_date);

-- ─── dev_config ──────────────────────────────────────────────────────────────
-- Key-value store for dev environment toggles.
-- Only accessible by service role (edge functions). Client has no access.
-- In production this table exists but has no rows — so AI runs normally.
-- In dev: seed with ('ai_enabled', 'false') to pause all AI calls.
CREATE TABLE dev_config (
  key   text PRIMARY KEY,
  value text NOT NULL
);

ALTER TABLE dev_config ENABLE ROW LEVEL SECURITY;

-- No client access — service role bypasses RLS
CREATE POLICY "dev_config_no_client_access" ON dev_config
  FOR ALL USING (false);

-- ─── ai_call_log ─────────────────────────────────────────────────────────────
-- Audit log for every AI edge function invocation.
-- Used to enforce per-function rate limits and track costs.
-- Only accessible by service role.
CREATE TABLE ai_call_log (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  function_name text NOT NULL,
  called_at     timestamptz DEFAULT now(),
  was_mock      boolean DEFAULT false
);

ALTER TABLE ai_call_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_log_no_client_access" ON ai_call_log
  FOR ALL USING (false);

CREATE INDEX idx_ai_log_user_fn_time ON ai_call_log (user_id, function_name, called_at DESC);

-- ============================================================
-- 065_push_tokens_table.sql
-- Security fix: profiles.push_token (a device push credential) was covered
-- only by profiles_select_public (001_core_identity.sql), which has no
-- column restriction -- Postgres RLS is row-level only, so any authenticated
-- user could `select push_token from profiles where id = '<other-user>'` via
-- the REST API. Confirmed unpopulated in current code (no client write path
-- exists yet), so this is a schema move, not a data migration.
-- ============================================================

CREATE TABLE IF NOT EXISTS push_tokens (
  user_id    uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  token      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

-- Users manage only their own token; there is no staff/public SELECT policy
-- at all -- edge functions read this via the service-role client
-- (getSupabaseClient(), which bypasses RLS), never via a user-scoped read.
CREATE POLICY "push_tokens_select_own" ON push_tokens FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "push_tokens_upsert_own" ON push_tokens FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "push_tokens_update_own" ON push_tokens FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "push_tokens_delete_own" ON push_tokens FOR DELETE USING (user_id = auth.uid());

ALTER TABLE profiles DROP COLUMN IF EXISTS push_token;

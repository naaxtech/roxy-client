-- Migration 007: Add soft-delete timestamp to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

COMMENT ON COLUMN profiles.deleted_at IS
  'Set when user requests deletion. Hard delete happens 30 days after this timestamp. NULL = active account.';

CREATE INDEX IF NOT EXISTS idx_profiles_deleted_at
  ON profiles (deleted_at)
  WHERE deleted_at IS NOT NULL;

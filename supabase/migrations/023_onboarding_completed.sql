-- Add onboarding_completed flag to profiles.
-- The root layout uses this to distinguish a fully-completed profile from one
-- that was partially created during onboarding (e.g. only step1 finished).
-- Without this, existing sessions would be redirected to onboarding on re-entry.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;

-- Mark existing profiles with a username as already completed so returning
-- users are not sent back through onboarding.
UPDATE profiles
  SET onboarding_completed = true
  WHERE username IS NOT NULL AND username <> '';

-- No new RLS policies needed — profiles table already enforces owner-only writes.

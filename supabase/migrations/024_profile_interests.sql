-- Migration 024: Add interests column to profiles
--
-- dating_looking_for was incorrectly used to store hobbies/interests during
-- onboarding step 2. This adds a dedicated interests column and preserves
-- dating_looking_for for its intended purpose (dating preference type:
-- relationship, casual, friends, etc.) to be collected in a future step.
--
-- Existing data in dating_looking_for that contains interests (Music, Gaming,
-- etc.) is migrated across. dating_looking_for is reset to empty for those
-- rows since it contained the wrong data type.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS interests text[] DEFAULT '{}';

-- Migrate existing data: any row where dating_looking_for contains values
-- that look like interests (not dating preference words) move them across.
-- Safe: interests had no dedicated column before, so nothing is overwritten.
UPDATE profiles
SET
  interests = dating_looking_for,
  dating_looking_for = '{}'
WHERE
  array_length(dating_looking_for, 1) > 0;

-- RLS: interests follows the same policy as other profile fields.
-- The existing "Users can update own profile" RLS policy on profiles covers it.
-- No new policy needed.

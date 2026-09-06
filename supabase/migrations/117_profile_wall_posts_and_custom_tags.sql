-- Posts live on the author's profile. Communities are approved special
-- accounts, not folders that own posts. Leftover community_id rows were the
-- reason comments and the profile wall looked empty after a woman posted.
--
-- custom_tags is the five labels she writes herself. Column privilege is
-- required because 080 revoked blanket UPDATE on profiles.

UPDATE public.posts
SET community_id = NULL,
    posted_as_community = false
WHERE community_id IS NOT NULL
   OR posted_as_community = true;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS custom_tags text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_custom_tags_max;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_custom_tags_max
  CHECK (cardinality(custom_tags) <= 5);

GRANT UPDATE (custom_tags) ON public.profiles TO authenticated;

-- 119 — Shop posts are a text / photo / video with a product attached.
--
-- Claude Design tags a shop item on a regular feed post (`shop: { pid, lbl }`).
-- The 045 check only allowed game / room / event, so a community account
-- could not write that tag.

ALTER TABLE public.posts
  DROP CONSTRAINT IF EXISTS posts_link_type_check;

ALTER TABLE public.posts
  ADD CONSTRAINT posts_link_type_check
  CHECK (link_type IS NULL OR link_type IN ('game', 'room', 'event', 'product'));

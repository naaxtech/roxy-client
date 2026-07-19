-- 062: user_id defaults on engagement tables
--
-- post_likes / post_saves / comment_likes were created (045) with
-- user_id NOT NULL and **no default**, while the client inserts only the
-- content id (e.g. `insert({ post_id })`). Every such insert arrived with
-- user_id NULL, failed the `user_id = auth.uid()` RLS WITH CHECK, and
-- PostgREST returned 403 — the optimistic UI then quietly reverted, so
-- likes and post-saves have been silently broken.
--
-- DEFAULT auth.uid() is the canonical Supabase pattern: the row is stamped
-- with the caller's identity server-side, which both satisfies RLS and
-- makes it impossible to forge another user's engagement row.
-- seen_posts included for consistency (its caller passes user_id today).

ALTER TABLE public.post_likes    ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.post_saves    ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.comment_likes ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.seen_posts    ALTER COLUMN user_id SET DEFAULT auth.uid();

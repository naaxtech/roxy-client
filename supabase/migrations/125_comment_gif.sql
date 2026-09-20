-- 125 — allow GIF / photo replies on thoughts
--
-- 045 added media_url/gif_url to comments and relaxed the CHECK so a comment
-- may be media-only, but left `content` NOT NULL from 013. The CHECK already
-- requires content OR media OR gif, so a truly empty comment is impossible —
-- this just lets a GIF-only reply (content = NULL) through, which is exactly
-- the shape the CHECK was written to permit and the client (Comment type,
-- `content: string | null`) already expects.

ALTER TABLE public.comments ALTER COLUMN content DROP NOT NULL;

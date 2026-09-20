-- Re-tightening is only safe while no media-only reply exists. If GIF replies
-- have been written, this fails (correctly) — delete them first, or leave the
-- column nullable.
ALTER TABLE public.comments ALTER COLUMN content SET NOT NULL;

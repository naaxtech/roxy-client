-- supabase/migrations/020_event_detail.sql
-- Adds is_private + is_paid to events, ticket_code to event_attendees

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_paid    boolean NOT NULL DEFAULT false;

ALTER TABLE public.event_attendees
  ADD COLUMN IF NOT EXISTS ticket_code text UNIQUE
    DEFAULT ('ROXY-' || upper(substr(gen_random_uuid()::text, 1, 8)));

-- Index for fast ticket lookup
CREATE INDEX IF NOT EXISTS idx_ea_ticket_code ON public.event_attendees(ticket_code);

-- Backfill ticket_code for any existing attendee rows that have NULL
UPDATE public.event_attendees
SET ticket_code = 'ROXY-' || upper(substr(gen_random_uuid()::text, 1, 8))
WHERE ticket_code IS NULL;

-- Now enforce NOT NULL
ALTER TABLE public.event_attendees
  ALTER COLUMN ticket_code SET NOT NULL;

-- Replace events_select RLS policy: public events visible to all authenticated users;
-- private events only visible to community members.
DROP POLICY IF EXISTS "events_select" ON public.events;

CREATE POLICY "events_select" ON public.events
  FOR SELECT TO authenticated
  USING (
    is_private = false
    OR (
      is_private = true
      AND community_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.community_members cm
        WHERE cm.community_id = public.events.community_id
          AND cm.user_id = auth.uid()
      )
    )
  );

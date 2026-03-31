-- supabase/migrations/008_event_rsvp_status.sql
-- Add status column to event_attendees to support 'going', 'interested', 'maybe' states

ALTER TABLE public.event_attendees
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'going'
  CHECK (status IN ('going', 'interested', 'maybe'));

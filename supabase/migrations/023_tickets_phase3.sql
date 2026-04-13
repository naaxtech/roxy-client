-- supabase/migrations/023_tickets_phase3.sql

-- 1. profiles: is_staff flag
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_staff boolean NOT NULL DEFAULT false;

-- 2. events: lifecycle columns
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'cancelled', 'completed')),
  ADD COLUMN IF NOT EXISTS payout_delay_days integer,
  ADD COLUMN IF NOT EXISTS payout_blocked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payout_released_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.profiles(id);

-- Paid events must have ends_at (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'events' AND constraint_name = 'events_paid_requires_ends_at'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_paid_requires_ends_at
        CHECK (NOT is_paid OR ends_at IS NOT NULL);
  END IF;
END $$;

-- 3. event_attendees: check-in columns
ALTER TABLE public.event_attendees
  ADD COLUMN IF NOT EXISTS is_checked_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS checked_in_at timestamptz;

-- 4. payment_logs: refund tracking columns + status extension
ALTER TABLE public.payment_logs
  ADD COLUMN IF NOT EXISTS needs_refund boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS refund_error text,
  ADD COLUMN IF NOT EXISTS stripe_refund_id text UNIQUE;

-- Extend status check to include new values (idempotent)
ALTER TABLE public.payment_logs
  DROP CONSTRAINT IF EXISTS payment_logs_status_check;
DO $$ BEGIN
  ALTER TABLE public.payment_logs
    ADD CONSTRAINT payment_logs_status_check
      CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded', 'paid_out'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 5. audit_log table
CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid,
  action text NOT NULL
    CHECK (action IN ('release_payout','block_payout','unblock_payout','cancel_event','retry_refund','mark_resolved')),
  target_type text NOT NULL CHECK (target_type IN ('event','payment_log')),
  target_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Named FK with ON DELETE SET NULL (allows staff accounts to be removed without orphaning logs)
ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_staff_fk FOREIGN KEY (staff_id)
    REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_log_staff_read" ON public.audit_log;
CREATE POLICY "audit_log_staff_read" ON public.audit_log
  FOR SELECT TO authenticated
  USING (staff_id = auth.uid());

-- 6. RLS: hosts read all attendees for their events
DROP POLICY IF EXISTS "host_read_attendees" ON public.event_attendees;
CREATE POLICY "host_read_attendees" ON public.event_attendees
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.events
      WHERE events.id = event_attendees.event_id
        AND events.host_id = auth.uid()
    )
  );

-- 7. RLS: hosts update is_checked_in on their own event attendees
DROP POLICY IF EXISTS "host_checkin_attendees" ON public.event_attendees;
CREATE POLICY "host_checkin_attendees" ON public.event_attendees
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.events
      WHERE events.id = event_attendees.event_id
        AND events.host_id = auth.uid()
    )
  )
  WITH CHECK (true);

-- 8. Indexes for new columns added in this migration
CREATE INDEX IF NOT EXISTS idx_events_status ON public.events(status);
CREATE INDEX IF NOT EXISTS idx_payment_logs_needs_refund ON public.payment_logs(needs_refund) WHERE needs_refund = true;
CREATE INDEX IF NOT EXISTS idx_audit_log_target ON public.audit_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_staff_id ON public.audit_log(staff_id);

-- 9. pg_cron: auto-complete paid events after ends_at (idempotent)
-- Wrapped in DO block so it is a no-op on local dev where pg_cron is not installed
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('complete-paid-events');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule(
      'complete-paid-events',
      '*/15 * * * *',
      $cron$
        UPDATE public.events
        SET status = 'completed'
        WHERE status = 'active'
          AND is_paid = true
          AND ends_at IS NOT NULL
          AND ends_at < now()
      $cron$
    );
  END IF;
END;
$$;

-- supabase/migrations/022_payments_phase2.sql

-- 1. Upgrade ticket_code to 16-char (64-bit entropy)
ALTER TABLE public.event_attendees
  ALTER COLUMN ticket_code
  SET DEFAULT ('ROXY-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)));

-- 2. Atomic claim_ticket function (SECURITY INVOKER — runs as calling role)
CREATE OR REPLACE FUNCTION public.claim_ticket(
  p_event_id uuid,
  p_buyer_id uuid
) RETURNS text LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_ticket_code text;
  v_max         integer;
  v_count       integer;
BEGIN
  SELECT max_attendees INTO v_max
  FROM public.events WHERE id = p_event_id;

  IF v_max IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count
    FROM public.event_attendees WHERE event_id = p_event_id;
    IF v_count >= v_max THEN
      RAISE EXCEPTION 'sold_out';
    END IF;
  END IF;

  INSERT INTO public.event_attendees (event_id, user_id)
  VALUES (p_event_id, p_buyer_id)
  ON CONFLICT DO NOTHING
  RETURNING ticket_code INTO v_ticket_code;

  -- If conflict (buyer already has ticket), return existing code
  IF v_ticket_code IS NULL THEN
    SELECT ticket_code INTO v_ticket_code
    FROM public.event_attendees
    WHERE event_id = p_event_id AND user_id = p_buyer_id;
  END IF;

  RETURN v_ticket_code;
END;
$$;

-- 3. payment_logs RLS: hosts read their own rows
CREATE POLICY "payment_logs_host_read" ON public.payment_logs
  FOR SELECT TO authenticated
  USING (host_id = auth.uid());

-- 4. cover_image_url must be https://
ALTER TABLE public.events
  ADD CONSTRAINT events_cover_image_url_https
  CHECK (cover_image_url IS NULL OR cover_image_url LIKE 'https://%');

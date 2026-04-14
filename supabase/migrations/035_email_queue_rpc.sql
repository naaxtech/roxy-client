-- supabase/migrations/034b_email_queue_rpc.sql
CREATE OR REPLACE FUNCTION public.claim_email_queue_batch(p_limit integer DEFAULT 10)
RETURNS SETOF public.email_queue LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
    UPDATE public.email_queue
    SET status = 'processing', processing_since = now()
    WHERE id IN (
      SELECT id FROM public.email_queue
      WHERE status IN ('pending','failed')
        AND next_retry_at <= now()
      ORDER BY next_retry_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
END $$;

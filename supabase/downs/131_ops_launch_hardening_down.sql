-- Down for 131_ops_launch_hardening.sql. Restores the pre-131 state exactly:
-- every grant from the snapshot 131 took, the original policy definitions,
-- function bodies and constraints. Keeps data: audit rows stay (their CHECKs
-- come back NOT VALID), reports keep their rows (status 'actioned' maps back
-- to 'reviewed'); only the columns, table and functions 131 added are dropped.
-- destructive-ok: down migration, drops only what 131 created

-- ── storage ────────────────────────────────────────────────────────────────
UPDATE storage.buckets SET file_size_limit = NULL, allowed_mime_types = NULL
WHERE id IN ('avatars', 'profile-photos', 'post-media', 'product-photos',
             'business-logos', 'room-banners', 'archive-covers');

DO $$
DECLARE
  v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'avatars_update_own', 'avatars_upload_own', 'post_media_delete', 'post_media_upload',
    'product_photos_delete', 'product_photos_upload', 'profile_photos_storage_delete',
    'profile_photos_storage_upload', 'room_banners_delete', 'room_banners_insert',
    'room_banners_update'
  ] LOOP
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = v_name) THEN
        EXECUTE format('ALTER POLICY %I ON storage.objects TO public', v_name);
      END IF;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE WARNING '131 down: could not move storage policy % back to public (%)', v_name, SQLERRM;
    END;
  END LOOP;
END $$;

-- ── functions 131 added ────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.ops_cleanup_stale_rooms();
DROP FUNCTION IF EXISTS public.ops_call_if_exists(text);
DROP FUNCTION IF EXISTS public.ops_invoke_edge(text, jsonb);
DROP FUNCTION IF EXISTS public.staff_launch_funnel();
DROP FUNCTION IF EXISTS public.staff_search_members(text, integer);
DROP FUNCTION IF EXISTS public.staff_set_payout_block(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.staff_resolve_report(uuid, text, text, boolean);
DROP FUNCTION IF EXISTS public.unsuspend_member(uuid, text);
DROP FUNCTION IF EXISTS public.suspend_member(uuid, text);
DROP FUNCTION IF EXISTS public.is_suspended(uuid);
DROP TRIGGER IF EXISTS trg_products_guard_status ON public.products;
DROP FUNCTION IF EXISTS public.products_guard_status();

-- ── reports ────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS public.reports_pending_idx;
DROP INDEX IF EXISTS public.reports_reported_user_idx;
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_resolution_action_check;
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_resolution_note_len;
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_status_check;
UPDATE public.reports SET status = 'reviewed' WHERE status = 'actioned';
ALTER TABLE public.reports ADD CONSTRAINT reports_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'reviewed'::text, 'dismissed'::text]));
ALTER TABLE public.reports
  DROP COLUMN IF EXISTS resolution_action,
  DROP COLUMN IF EXISTS resolution_note,
  DROP COLUMN IF EXISTS resolved_at,
  DROP COLUMN IF EXISTS resolved_by;

-- ── suspensions ────────────────────────────────────────────────────────────
-- Lift any auth ban this table caused before the table goes.
UPDATE auth.users u SET banned_until = NULL
FROM public.account_suspensions s
WHERE s.user_id = u.id AND s.lifted_at IS NULL;
DROP TABLE IF EXISTS public.account_suspensions;

-- ── audit log ──────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS public.audit_log_created_idx;
DROP FUNCTION IF EXISTS public.staff_audit(text, text, uuid, jsonb);
ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_action_check
  CHECK (action = ANY (ARRAY['release_payout'::text, 'block_payout'::text, 'unblock_payout'::text,
                             'cancel_event'::text, 'retry_refund'::text, 'mark_resolved'::text])) NOT VALID;
ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_target_type_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_target_type_check
  CHECK (target_type = ANY (ARRAY['event'::text, 'payment_log'::text])) NOT VALID;

-- ── original function bodies ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.increment_reaction(p_post_id uuid, p_emoji text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.posts
  SET reaction_counts = jsonb_set(
    COALESCE(reaction_counts, '{}'::jsonb),
    ARRAY[p_emoji],
    to_jsonb(COALESCE((reaction_counts->>p_emoji)::int, 0) + 1)
  )
  WHERE id = p_post_id;
END;
$$;
ALTER FUNCTION public.increment_reaction(uuid, text) RESET search_path;

CREATE OR REPLACE FUNCTION public.increment_participant_count(p_room_name text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE community_rooms
  SET participant_count = GREATEST(0, participant_count + 1)
  WHERE daily_room_name = p_room_name AND status = 'live';
$$;
CREATE OR REPLACE FUNCTION public.decrement_participant_count(p_room_name text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE community_rooms
  SET participant_count = GREATEST(0, participant_count - 1)
  WHERE daily_room_name = p_room_name AND status = 'live';
$$;
ALTER FUNCTION public.increment_participant_count(text) RESET search_path;
ALTER FUNCTION public.decrement_participant_count(text) RESET search_path;

ALTER FUNCTION public.award_badge_points() RESET search_path;
ALTER FUNCTION public.sync_comment_like_count() RESET search_path;
ALTER FUNCTION public.sync_post_like_count() RESET search_path;
ALTER FUNCTION public.sync_post_save_count() RESET search_path;
ALTER FUNCTION public.sync_qotd_answer_count() RESET search_path;
ALTER FUNCTION public.sync_supporter_count() RESET search_path;
ALTER FUNCTION public.update_attendee_count() RESET search_path;
ALTER FUNCTION public.update_comment_count() RESET search_path;
ALTER FUNCTION public.update_conversation_last_message_at() RESET search_path;

-- ── policies ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS email_queue_staff_read ON public.email_queue;
DROP POLICY IF EXISTS email_queue_staff_retry ON public.email_queue;
DROP POLICY IF EXISTS reconciliation_alerts_staff_read ON public.reconciliation_alerts;
DROP POLICY IF EXISTS reconciliation_alerts_staff_resolve ON public.reconciliation_alerts;

DROP POLICY IF EXISTS biz_insert ON public.businesses;
CREATE POLICY biz_insert ON public.businesses FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());
DROP POLICY IF EXISTS biz_update ON public.businesses;
CREATE POLICY biz_update ON public.businesses FOR UPDATE TO authenticated
  USING (owner_id = auth.uid());
DROP POLICY IF EXISTS products_insert ON public.products;
CREATE POLICY products_insert ON public.products FOR INSERT TO authenticated
  WITH CHECK (business_id IN (SELECT businesses.id FROM public.businesses WHERE businesses.owner_id = auth.uid()));
DROP POLICY IF EXISTS products_update ON public.products;
CREATE POLICY products_update ON public.products FOR UPDATE TO authenticated
  USING (business_id IN (SELECT businesses.id FROM public.businesses WHERE businesses.owner_id = auth.uid()));
DROP POLICY IF EXISTS events_insert ON public.events;
CREATE POLICY events_insert ON public.events FOR INSERT TO authenticated
  WITH CHECK (host_id = auth.uid());
DROP POLICY IF EXISTS events_update ON public.events;
CREATE POLICY events_update ON public.events FOR UPDATE TO authenticated
  USING (host_id = auth.uid());
DROP POLICY IF EXISTS ea_insert ON public.event_attendees;
CREATE POLICY ea_insert ON public.event_attendees FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Owners can update build fields" ON public.games;
CREATE POLICY "Owners can update build fields" ON public.games FOR UPDATE TO authenticated
  USING (submitted_by = auth.uid() AND status = ANY (ARRAY['pitch_approved'::text, 'build_changes'::text]));
DROP POLICY IF EXISTS "Authenticated users can submit games" ON public.games;
CREATE POLICY "Authenticated users can submit games" ON public.games FOR INSERT TO authenticated
  WITH CHECK (submitted_by = auth.uid());

ALTER POLICY ai_log_no_client_access ON public.ai_call_log TO public;
ALTER POLICY app_feedback_insert_own ON public.app_feedback TO public;
ALTER POLICY app_feedback_select_own ON public.app_feedback TO public;
ALTER POLICY "authenticated users read photos" ON public.business_photos TO public;
ALTER POLICY community_rooms_insert ON public.community_rooms TO public;
ALTER POLICY community_rooms_select ON public.community_rooms TO public;
ALTER POLICY community_rooms_update ON public.community_rooms TO public;
ALTER POLICY dev_config_no_client_access ON public.dev_config TO public;
ALTER POLICY donations_select_own ON public.donations TO public;
ALTER POLICY feature_requests_pitch ON public.feature_requests TO public;
ALTER POLICY feature_votes_delete ON public.feature_votes TO public;
ALTER POLICY feature_votes_insert ON public.feature_votes TO public;
ALTER POLICY hsa_own_read ON public.host_stripe_accounts TO public;
ALTER POLICY hsa_own_update ON public.host_stripe_accounts TO public;
ALTER POLICY matches_own ON public.matches TO public;
ALTER POLICY notifications_select_own ON public.notifications TO public;
ALTER POLICY notifications_update_own ON public.notifications TO public;
ALTER POLICY push_tokens_delete_own ON public.push_tokens TO public;
ALTER POLICY push_tokens_select_own ON public.push_tokens TO public;
ALTER POLICY push_tokens_update_own ON public.push_tokens TO public;
ALTER POLICY push_tokens_upsert_own ON public.push_tokens TO public;
ALTER POLICY reports_insert_own ON public.reports TO public;
ALTER POLICY reports_select_own ON public.reports TO public;
ALTER POLICY greetings_own ON public.roxy_greetings TO public;
ALTER POLICY sdl_insert_own ON public.speed_date_likes TO public;
ALTER POLICY sdl_select_participant ON public.speed_date_likes TO public;
ALTER POLICY speed_date_insert_auth ON public.speed_date_sessions TO public;
ALTER POLICY speed_date_participant_update ON public.speed_date_sessions TO public;
ALTER POLICY speed_date_read_auth ON public.speed_date_sessions TO public;
ALTER POLICY speed_date_read_participant ON public.speed_date_sessions TO public;
ALTER POLICY "users manage own bookmarks" ON public.user_business_bookmarks TO public;
ALTER POLICY "users manage own supports" ON public.user_project_supports TO public;

-- ── default privileges ─────────────────────────────────────────────────────
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;

-- ── grants: clear 131's column grants, then replay the snapshot ────────────
-- 131 also GRANTs service_role EXECUTE on claim_email_queue_batch,
-- claim_ticket, increment/decrement_variant_stock. Those grants are NOT
-- revoked here: Supabase's default privileges already gave service_role
-- EXECUTE on every postgres-owned function, so the grant was a no-op before
-- 131, and the snapshot (PUBLIC/anon/authenticated only) could not restore
-- it. Revoking it broke the edge functions that claim email batches and
-- tickets after a rollback (proved by the exact-state cycle).
-- A table-level REVOKE also removes that privilege from every column.
REVOKE INSERT, UPDATE ON public.businesses, public.products, public.events,
              public.event_attendees, public.community_rooms, public.posts,
              public.email_queue, public.reconciliation_alerts, public.reports
  FROM authenticated;

DO $$
DECLARE
  r record;
  v_who text;
BEGIN
  IF to_regclass('public.ops_acl_snapshot_131') IS NULL THEN
    RAISE EXCEPTION '131 down: grant snapshot missing; refusing to guess the old grants';
  END IF;
  FOR r IN SELECT * FROM public.ops_acl_snapshot_131 ORDER BY id LOOP
    v_who := CASE WHEN r.grantee = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(r.grantee) END;
    BEGIN
      IF r.object_kind = 'function' THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %s', r.object_name, v_who);
      ELSIF r.object_kind = 'sequence' THEN
        EXECUTE format('GRANT %s ON SEQUENCE %s TO %s', r.privilege, r.object_name, v_who);
      ELSIF r.object_kind = 'column' THEN
        EXECUTE format('GRANT %s (%I) ON %s TO %s', r.privilege, r.column_name, r.object_name, v_who);
      ELSE
        EXECUTE format('GRANT %s ON %s TO %s', r.privilege, r.object_name, v_who);
      END IF;
    EXCEPTION WHEN undefined_table OR undefined_function OR undefined_column THEN
      NULL;  -- object dropped since 131 ran; nothing to restore
    END;
  END LOOP;
END $$;

DROP TABLE IF EXISTS public.ops_acl_snapshot_131;

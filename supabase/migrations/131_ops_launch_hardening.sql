-- ============================================================
-- 131_ops_launch_hardening.sql  (OPS lane — launch hardening)
--
-- Audit: scratch roxy-launch/audit-studio-backend.md. Findings closed here:
--   SB-01  anon could call SECURITY DEFINER RPCs that need no identity
--          (rig polls/reactions, fake room occupancy, probe applicant scores)
--   SB-03  owners could UPDATE money/trust columns (self-approve, own fee tier,
--          unblock own payout, free tickets to paid events, own feed rank)
--   SB-05  anon/authenticated held full table privileges incl. TRUNCATE
--   SB-08  no way to suspend a member
--   SB-11  storage buckets had no size or MIME limits
--   SB-12  staff audit inserts failed silently (no INSERT path at all)
--   ST-01/02/03/05  backing RPCs for the Studio reports queue, member search,
--          core-only payout block and the launch funnel
--   + the 32 `TO public` policies on ops-owned tables move to authenticated
--
-- Lane boundaries (IMPL-BRIEF): gate owns profiles / applications / invite
-- codes; chat owns conversations / messages / communities / community_members
-- / friendships / channels; feed owns posts / comments / archive_*. This file
-- changes NO policy on those tables. The ONE exception, agreed in the brief, is
-- column-level privileges on public.posts so an author cannot write her own
-- feed_score / counters / flags (feed lane's posts policies are untouched).
--
-- Nothing here depends on pg_cron / pg_net / Vault being configured: the cron
-- helpers return quietly when they are absent. scripts/setup-cron.sql (run by
-- a human, docs/ops/launch-runbook.md) turns the schedule on.
--
-- Down: supabase/downs/131_ops_launch_hardening_down.sql (restores the exact
-- pre-131 grants from the snapshot taken in section 0).
-- ============================================================

-- ── 0. Grant snapshot (so the down can restore exactly what was there) ─────
CREATE TABLE IF NOT EXISTS public.ops_acl_snapshot_131 (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  object_kind text NOT NULL CHECK (object_kind IN ('table', 'sequence', 'function', 'column')),
  object_name text NOT NULL,
  column_name text,
  grantee     text NOT NULL,
  privilege   text NOT NULL,
  taken_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ops_acl_snapshot_131 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ops_acl_snapshot_131 FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.ops_acl_snapshot_131 IS
  'Pre-131 grants to PUBLIC/anon/authenticated on public tables, columns, sequences and functions. Read only by supabase/downs/131_ops_launch_hardening_down.sql.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ops_acl_snapshot_131) THEN
    RETURN;  -- re-run: keep the first (true pre-131) snapshot
  END IF;

  INSERT INTO public.ops_acl_snapshot_131 (object_kind, object_name, grantee, privilege)
  SELECT CASE c.relkind WHEN 'S' THEN 'sequence' ELSE 'table' END,
         format('public.%I', c.relname),
         CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END,
         a.privilege_type
  FROM pg_class c
  CROSS JOIN LATERAL aclexplode(c.relacl) a
  WHERE c.relnamespace = 'public'::regnamespace
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
    AND (a.grantee = 0 OR a.grantee IN ('anon'::regrole, 'authenticated'::regrole));

  INSERT INTO public.ops_acl_snapshot_131 (object_kind, object_name, column_name, grantee, privilege)
  SELECT 'column', format('public.%I', c.relname), a.attname,
         CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE x.grantee::regrole::text END,
         x.privilege_type
  FROM pg_class c
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
  CROSS JOIN LATERAL aclexplode(a.attacl) x
  WHERE c.relnamespace = 'public'::regnamespace
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND (x.grantee = 0 OR x.grantee IN ('anon'::regrole, 'authenticated'::regrole));

  INSERT INTO public.ops_acl_snapshot_131 (object_kind, object_name, grantee, privilege)
  SELECT 'function',
         format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid)),
         CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END,
         a.privilege_type
  FROM pg_proc p
  CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.prokind IN ('f', 'p')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
    AND (a.grantee = 0 OR a.grantee IN ('anon'::regrole, 'authenticated'::regrole));
END $$;

-- ── 1. Staff audit log: one write path that cannot fail silently (SB-12) ───
-- audit_log has never had an INSERT policy, so the Studio's direct insert in
-- api/staff/block-payout failed with nothing checking the error, and the table
-- is empty on prod. Staff writes now go through this function, which RAISES on
-- any failure — the caller's transaction (and its staff action) fails with it.
-- The table's CHECKs listed six actions and two target types, so every other
-- audit insert (staff-approve-business: business_approved / 'business') was
-- rejected too, unnoticed. Vocabulary is now a format, not a frozen list.
ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_action_check
  CHECK (action ~ '^[a-z][a-z0-9_]{1,79}$');
ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_target_type_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_target_type_check
  CHECK (target_type IN ('event', 'payment_log', 'business', 'product', 'profile', 'report',
                         'post', 'room', 'archive_entry', 'archive_review', 'invite_code',
                         'community', 'email', 'game', 'order'));
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON public.audit_log (created_at DESC);

CREATE OR REPLACE FUNCTION public.staff_audit(
  p_action      text,
  p_target_type text,
  p_target_id   uuid,
  p_metadata    jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_id    uuid;
BEGIN
  IF v_actor IS NULL OR NOT public.is_roxy_staff() THEN
    RAISE EXCEPTION 'Only Roxy staff can write the audit log' USING ERRCODE = '42501';
  END IF;
  IF p_action IS NULL OR btrim(p_action) = ''
     OR p_target_type IS NULL OR btrim(p_target_type) = ''
     OR p_target_id IS NULL THEN
    RAISE EXCEPTION 'An audit row needs an action, a target type and a target id' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.audit_log (staff_id, action, target_type, target_id, metadata)
  VALUES (v_actor, btrim(p_action), btrim(p_target_type), p_target_id,
          coalesce(p_metadata, '{}'::jsonb))
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.staff_audit(text, text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_audit(text, text, uuid, jsonb) TO authenticated;

-- ── 2. Function EXECUTE sweep (SB-01) ──────────────────────────────────────
-- No function in public is meant for a signed-out caller: the only pre-account
-- path (invite-code validation) is the validate-invite-code edge function,
-- which uses the service role. apps/mobile makes no .rpc() call before login
-- (grepped: every rpc call site is behind a session). So the anon allowlist is
-- EMPTY. Authenticated keeps every explicit grant it already had (prod: 0
-- functions reachable by authenticated ONLY through PUBLIC, so revoking PUBLIC
-- removes nothing a signed-in member uses).
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;

-- New functions: no implicit EXECUTE for PUBLIC (global — Postgres cannot
-- revoke a PUBLIC default per schema) and none for anon in public.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;

-- Called only by edge functions with the service role. Not SECURITY DEFINER,
-- but a member calling them directly could claim the email queue, move stock
-- or mint a ticket.
REVOKE EXECUTE ON FUNCTION public.claim_email_queue_batch(integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_variant_stock(uuid, integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.decrement_variant_stock(uuid, integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_ticket(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_email_queue_batch(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_variant_stock(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.decrement_variant_stock(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_ticket(uuid, uuid) TO service_role;

-- claim_speed_date_partner(p_user_id, ...) trusts its user-id argument: 077
-- made it service-role only, then 102 (block filter) re-created it with
-- GRANT ... TO authenticated, so any member could pull any other member into
-- a video call (prod: authenticated=X, found by db-verify's 077 check). Its
-- only caller is the join-speed-date-session edge function, which uses the
-- service role (getSupabaseClient). Back to service-role only.
REVOKE EXECUTE ON FUNCTION public.claim_speed_date_partner(uuid, uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_speed_date_partner(uuid, uuid, integer) TO service_role;

-- ── 3. Reactions and room counters need a caller (SB-01) ───────────────────
-- increment_reaction wrote any key into any post's reaction_counts for anyone
-- holding the anon key. Now: signed in, can read the post, and the key is one
-- of the six reactions (apps/mobile/lib/postReactions.ts POST_REACTIONS) or a
-- poll option key `poll:<n>` (apps/mobile/components/feed/poll.ts).
CREATE OR REPLACE FUNCTION public.increment_reaction(p_post_id uuid, p_emoji text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to react' USING ERRCODE = '42501';
  END IF;
  IF p_emoji IS NULL OR NOT (
       p_emoji = ANY (ARRAY[U&'\2764\FE0F', U&'\+01F602', U&'\+01F62E',
                            U&'\+01F622', U&'\+01F621', U&'\+01F49C'])
       OR p_emoji ~ '^poll:[0-9]{1,2}$'
     ) THEN
    RAISE EXCEPTION 'That is not a reaction' USING ERRCODE = '22023';
  END IF;
  IF NOT coalesce(public.can_read_post(p_post_id), false) THEN
    RAISE EXCEPTION 'Post not found' USING ERRCODE = '42501';
  END IF;

  UPDATE public.posts
  SET reaction_counts = jsonb_set(
    coalesce(reaction_counts, '{}'::jsonb),
    ARRAY[p_emoji],
    to_jsonb(coalesce((reaction_counts->>p_emoji)::int, 0) + 1)
  )
  WHERE id = p_post_id AND deleted_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION public.increment_reaction(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_reaction(uuid, text) TO authenticated;

-- Only daily-webhook (service role, Daily signature verified) moves occupancy.
CREATE OR REPLACE FUNCTION public.increment_participant_count(p_room_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- The only caller is daily-webhook (service role, Daily signature checked).
  -- A signed-in member is refused here too, not only by the missing grant.
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Room occupancy is set by the room provider only' USING ERRCODE = '42501';
  END IF;
  UPDATE public.community_rooms
  SET participant_count = GREATEST(0, participant_count + 1)
  WHERE daily_room_name = p_room_name AND status = 'live';
END $$;

CREATE OR REPLACE FUNCTION public.decrement_participant_count(p_room_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- The only caller is daily-webhook (service role, Daily signature checked).
  -- A signed-in member is refused here too, not only by the missing grant.
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Room occupancy is set by the room provider only' USING ERRCODE = '42501';
  END IF;
  UPDATE public.community_rooms
  SET participant_count = GREATEST(0, participant_count - 1)
  WHERE daily_room_name = p_room_name AND status = 'live';
END $$;
REVOKE ALL ON FUNCTION public.increment_participant_count(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.decrement_participant_count(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_participant_count(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.decrement_participant_count(text) TO service_role;

-- ── 4. search_path on the remaining SECURITY DEFINER functions (SB-01, D1) ──
ALTER FUNCTION public.award_badge_points() SET search_path = public, pg_temp;
ALTER FUNCTION public.sync_comment_like_count() SET search_path = public, pg_temp;
ALTER FUNCTION public.sync_post_like_count() SET search_path = public, pg_temp;
ALTER FUNCTION public.sync_post_save_count() SET search_path = public, pg_temp;
ALTER FUNCTION public.sync_qotd_answer_count() SET search_path = public, pg_temp;
ALTER FUNCTION public.sync_supporter_count() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_attendee_count() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_comment_count() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_conversation_last_message_at() SET search_path = public, pg_temp;

-- ── 5. Table privilege sweep (SB-05) ───────────────────────────────────────
-- anon: no writes anywhere, and no TRUNCATE/REFERENCES/TRIGGER for either
-- role. RLS stays the row-level control; this makes one future permissive
-- policy or a forgotten RLS flag no longer a world-writable table.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM anon', r.relname);
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM authenticated', r.relname);
  END LOOP;
END $$;

-- anon SELECT: no ops-owned table has a policy a signed-out caller needs.
-- Tables owned by the gate/chat/feed lanes are left to their own migrations.
DO $$
DECLARE
  r record;
  v_other_lanes text[] := ARRAY[
    -- gate
    'profiles', 'membership_applications', 'invite_codes', 'applicant_identity',
    'reviewer_settings', 'code_attempts', 'member_safety', 'gate_settings',
    'identity_verifications', 'verification_criteria', 'member_invite_grants',
    -- chat
    'conversations', 'messages', 'conversation_members', 'friendships',
    'message_reactions', 'community_members', 'communities', 'chat_settings',
    'message_revisions', 'community_bans',
    -- feed
    'posts', 'comments', 'post_reactions', 'post_likes', 'post_saves',
    'comment_likes', 'hidden_posts', 'mutes', 'follows', 'seen_posts',
    'profile_prompts'
  ];
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r', 'p')
      AND NOT (c.relname = ANY (v_other_lanes))
      AND c.relname NOT LIKE 'application\_%'
      AND c.relname NOT LIKE 'archive\_%'
      AND c.relname NOT LIKE 'community\_channel%'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('REVOKE SELECT ON public.%I FROM anon', r.relname);
  END LOOP;
END $$;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;

-- Service-only tables: written by edge functions / definer functions only.
REVOKE ALL ON public.ai_call_log, public.dev_config, public.email_delivery_events,
              public.marketplace_settings, public.platform_settings, public.webhook_events
  FROM anon, authenticated;

-- Money ledgers: members and sellers READ their own rows (existing policies);
-- every write is a webhook or edge function with the service role.
REVOKE INSERT, UPDATE, DELETE ON public.audit_log, public.payment_logs, public.refunds,
              public.disputes, public.seller_payouts, public.orders, public.order_items,
              public.order_events, public.donations, public.fee_tiers,
              public.host_stripe_accounts
  FROM authenticated;

-- Staff queues the Studio retries / resolves: one column each, staff only.
REVOKE INSERT, UPDATE, DELETE ON public.email_queue, public.reconciliation_alerts FROM authenticated;
GRANT UPDATE (status, last_error, next_retry_at) ON public.email_queue TO authenticated;
GRANT UPDATE (resolved_at) ON public.reconciliation_alerts TO authenticated;

DROP POLICY IF EXISTS email_queue_staff_read ON public.email_queue;
CREATE POLICY email_queue_staff_read ON public.email_queue
  FOR SELECT TO authenticated
  USING (public.is_roxy_staff());
DROP POLICY IF EXISTS email_queue_staff_retry ON public.email_queue;
CREATE POLICY email_queue_staff_retry ON public.email_queue
  FOR UPDATE TO authenticated
  USING (public.is_roxy_staff())
  WITH CHECK (public.is_roxy_staff() AND status = 'pending');

DROP POLICY IF EXISTS reconciliation_alerts_staff_read ON public.reconciliation_alerts;
CREATE POLICY reconciliation_alerts_staff_read ON public.reconciliation_alerts
  FOR SELECT TO authenticated
  USING (public.is_roxy_staff());
DROP POLICY IF EXISTS reconciliation_alerts_staff_resolve ON public.reconciliation_alerts;
CREATE POLICY reconciliation_alerts_staff_resolve ON public.reconciliation_alerts
  FOR UPDATE TO authenticated
  USING (public.is_roxy_staff())
  WITH CHECK (public.is_roxy_staff());

-- ── 6. Money and trust columns (SB-03) ─────────────────────────────────────
-- Grants decide which COLUMNS, RLS decides which ROWS. Each editable list is
-- what apps/studio and apps/mobile actually write (grepped call sites); every
-- column that approves, prices after the fact, pays out or ranks is absent and
-- moves only through staff edge functions (service role) or definer RPCs.

-- businesses: settings/business-actions.ts createBusiness / updateBusiness.
-- NOT editable by the owner: can_sell, is_verified, stripe_account_id,
-- stripe_onboarded_at, payout_schedule_set, currency.
REVOKE INSERT, UPDATE ON public.businesses FROM authenticated;
GRANT INSERT (owner_id, name, description, category, location_city, is_wlw_owned,
              website_url, instagram_handle, tiktok_handle, facebook_url,
              contact_email, phone, logo_url)
  ON public.businesses TO authenticated;
GRANT UPDATE (name, description, category, location_city, is_wlw_owned, website_url,
              instagram_handle, tiktok_handle, facebook_url, contact_email, phone,
              logo_url, business_rejection_reason)
  ON public.businesses TO authenticated;
ALTER POLICY biz_insert ON public.businesses
  WITH CHECK (owner_id = auth.uid() AND public.is_approved_member());
ALTER POLICY biz_update ON public.businesses
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- products: products/actions.ts. status may only move to pending/archived by
-- the owner (the trigger below); approval is staff-approve-product.
REVOKE INSERT, UPDATE ON public.products FROM authenticated;
GRANT INSERT (business_id, name, description, category, base_price_cents, is_active,
              has_variants, status)
  ON public.products TO authenticated;
GRANT UPDATE (name, description, category, base_price_cents, is_active, has_variants, status)
  ON public.products TO authenticated;
ALTER POLICY products_insert ON public.products
  WITH CHECK (
    status = 'pending'
    AND business_id IN (SELECT b.id FROM public.businesses b WHERE b.owner_id = auth.uid())
  );
ALTER POLICY products_update ON public.products
  USING (business_id IN (SELECT b.id FROM public.businesses b WHERE b.owner_id = auth.uid()))
  WITH CHECK (business_id IN (SELECT b.id FROM public.businesses b WHERE b.owner_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.products_guard_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- A member's own request (auth.uid() set) may withdraw or archive; only
  -- staff approve or reject. The service role (staff-approve-product) and
  -- migrations have no auth.uid() and pass.
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status NOT IN ('pending', 'archived')
     AND auth.uid() IS NOT NULL
     AND NOT public.is_roxy_staff() THEN
    RAISE EXCEPTION 'Only Roxy staff can approve or reject a product' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.products_guard_status() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_products_guard_status ON public.products;
CREATE TRIGGER trg_products_guard_status
  BEFORE UPDATE OF status ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.products_guard_status();

-- events: events/CreateEventForm.tsx + mobile community/create-event.tsx
-- insert; hosts edit the descriptive fields. NOT editable: payout_blocked,
-- payout_released_at, attendee_count, status, cancelled_*, price/paid after
-- creation (cancel-event and the payout functions own those).
REVOKE INSERT, UPDATE ON public.events FROM authenticated;
GRANT INSERT (title, host_id, community_id, event_type, starts_at, ends_at, description,
              location_text, location_url, cover_image_url, max_attendees, is_private,
              is_paid, price_cents, currency, payout_delay_days)
  ON public.events TO authenticated;
GRANT UPDATE (title, description, event_type, starts_at, ends_at, location_text,
              location_url, cover_image_url, max_attendees, is_private)
  ON public.events TO authenticated;
ALTER POLICY events_insert ON public.events
  WITH CHECK (
    host_id = auth.uid()
    AND public.is_approved_member()
    AND (payout_delay_days IS NULL OR payout_delay_days BETWEEN 3 AND 30)
  );
ALTER POLICY events_update ON public.events
  USING (host_id = auth.uid())
  WITH CHECK (host_id = auth.uid());

-- event_attendees: an RSVP names the event, herself and going/interested.
-- ticket_code / is_checked_in come from claim_ticket (Stripe webhook) and
-- checkin_attendee; a direct RSVP to a PAID event was a free ticket.
REVOKE INSERT, UPDATE ON public.event_attendees FROM authenticated;
GRANT INSERT (event_id, user_id, status) ON public.event_attendees TO authenticated;
ALTER POLICY ea_insert ON public.event_attendees
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_attendees.event_id
        AND NOT e.is_paid
        AND e.status = 'active'
    )
  );

-- community_rooms: hosts/admins edit the room's face; occupancy and lifecycle
-- (participant_count, status, started/ended, daily_*) belong to manage-room,
-- daily-webhook and ops_cleanup_stale_rooms().
REVOKE INSERT, UPDATE ON public.community_rooms FROM authenticated;
GRANT INSERT (community_id, name, description, room_type, created_by, scheduled_at,
              max_participants, banner_url)
  ON public.community_rooms TO authenticated;
GRANT UPDATE (name, description, scheduled_at, max_participants, banner_url)
  ON public.community_rooms TO authenticated;

-- posts (FEED lane's table — columns only, its policies untouched): an author
-- writes her content, never her rank, counters, flag or pin. feed_score,
-- like_count, save_count, comment_count, reaction_counts, community_resonance,
-- is_flagged, is_pinned, announced_on are maintained by definer triggers/RPCs.
REVOKE INSERT, UPDATE ON public.posts FROM authenticated;
GRANT INSERT (author_id, community_id, content, media_urls, post_type, video_url,
              video_thumbnail_url, video_duration_secs, video_aspect_ratio, link_type,
              link_entity_id, link_community_id, blurhash, post_tags, posted_as_community)
  ON public.posts TO authenticated;
GRANT UPDATE (content, media_urls, post_tags, blurhash, deleted_at, updated_at,
              link_type, link_entity_id, link_community_id, video_aspect_ratio)
  ON public.posts TO authenticated;

-- games: the owner's update must stay inside her own build flow; the pitch
-- insert cannot arrive already live. (USING without WITH CHECK let her set
-- status = 'live' on her own pitch.)
ALTER POLICY "Owners can update build fields" ON public.games
  USING (submitted_by = auth.uid() AND status IN ('pitch_approved', 'build_changes'))
  WITH CHECK (submitted_by = auth.uid() AND status IN ('pitch_approved', 'build_changes', 'build_pending'));
ALTER POLICY "Authenticated users can submit games" ON public.games
  WITH CHECK (submitted_by = auth.uid() AND status = 'pitch_pending' AND publisher_type = 'community');

-- games.slug (from 016) is NOT NULL with no default in production, and the
-- Studio pitch form (apps/studio games/submit) never sends one: every pitch
-- insert failed with 23502 there. The local dev stack had a hand-added
-- default (gen_random_uuid()::text) that hid it. Same default here, only when
-- the column has none; slug stays the stable route key for built-in games
-- (lib/contentNavigation GAME_ROUTES) and a pitch's uuid slug never matches
-- one. The down removes it only if 131 is the one that set it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'games'
               AND column_name = 'slug' AND column_default IS NULL) THEN
    ALTER TABLE public.games ALTER COLUMN slug SET DEFAULT (gen_random_uuid())::text;
    COMMENT ON COLUMN public.games.slug IS
      'Stable key; built-in games carry a route slug. Default (uuid text) set by 131 for community pitches.';
  END IF;
END $$;

-- ── 7. The 32 `TO public` policies on ops-owned tables → authenticated ─────
-- (communities x3, community_members x4, friendships x1 are chat's.)
ALTER POLICY ai_log_no_client_access ON public.ai_call_log TO authenticated;
ALTER POLICY app_feedback_insert_own ON public.app_feedback TO authenticated;
ALTER POLICY app_feedback_select_own ON public.app_feedback TO authenticated;
ALTER POLICY "authenticated users read photos" ON public.business_photos TO authenticated;
ALTER POLICY community_rooms_insert ON public.community_rooms TO authenticated;
ALTER POLICY community_rooms_select ON public.community_rooms TO authenticated;
ALTER POLICY community_rooms_update ON public.community_rooms TO authenticated;
ALTER POLICY dev_config_no_client_access ON public.dev_config TO authenticated;
ALTER POLICY donations_select_own ON public.donations TO authenticated;
ALTER POLICY feature_requests_pitch ON public.feature_requests TO authenticated;
ALTER POLICY feature_votes_delete ON public.feature_votes TO authenticated;
ALTER POLICY feature_votes_insert ON public.feature_votes TO authenticated;
ALTER POLICY hsa_own_read ON public.host_stripe_accounts TO authenticated;
ALTER POLICY hsa_own_update ON public.host_stripe_accounts TO authenticated;
ALTER POLICY matches_own ON public.matches TO authenticated;
ALTER POLICY notifications_select_own ON public.notifications TO authenticated;
ALTER POLICY notifications_update_own ON public.notifications TO authenticated;
ALTER POLICY push_tokens_delete_own ON public.push_tokens TO authenticated;
ALTER POLICY push_tokens_select_own ON public.push_tokens TO authenticated;
ALTER POLICY push_tokens_update_own ON public.push_tokens TO authenticated;
ALTER POLICY push_tokens_upsert_own ON public.push_tokens TO authenticated;
ALTER POLICY reports_insert_own ON public.reports TO authenticated;
ALTER POLICY reports_select_own ON public.reports TO authenticated;
ALTER POLICY greetings_own ON public.roxy_greetings TO authenticated;
ALTER POLICY sdl_insert_own ON public.speed_date_likes TO authenticated;
ALTER POLICY sdl_select_participant ON public.speed_date_likes TO authenticated;
ALTER POLICY speed_date_insert_auth ON public.speed_date_sessions TO authenticated;
ALTER POLICY speed_date_participant_update ON public.speed_date_sessions TO authenticated;
ALTER POLICY speed_date_read_auth ON public.speed_date_sessions TO authenticated;
ALTER POLICY speed_date_read_participant ON public.speed_date_sessions TO authenticated;
ALTER POLICY "users manage own bookmarks" ON public.user_business_bookmarks TO authenticated;
ALTER POLICY "users manage own supports" ON public.user_project_supports TO authenticated;

-- ── 8. Account suspension (SB-08, ST-02) ───────────────────────────────────
-- profiles is the gate lane's table, so suspension lives beside it. A history
-- row per suspension; the active one has lifted_at IS NULL. Enforcement:
--   * suspend_member() bans the auth user and deletes her sessions and refresh
--     tokens, so no new access token is ever minted;
--   * is_suspended(uuid) is for gate's is_approved_member() to cut a token
--     that is still alive (cross-lane request: up to 1 h otherwise).
CREATE TABLE IF NOT EXISTS public.account_suspensions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason        text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 2000),
  suspended_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  suspended_at  timestamptz NOT NULL DEFAULT now(),
  lifted_at     timestamptz,
  lifted_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  lift_note     text CHECK (lift_note IS NULL OR char_length(lift_note) <= 2000),
  CHECK (lifted_at IS NULL OR lifted_at >= suspended_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS account_suspensions_one_active
  ON public.account_suspensions (user_id) WHERE lifted_at IS NULL;
CREATE INDEX IF NOT EXISTS account_suspensions_user_idx
  ON public.account_suspensions (user_id, suspended_at DESC);
ALTER TABLE public.account_suspensions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_suspensions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.account_suspensions TO authenticated;
DROP POLICY IF EXISTS account_suspensions_staff_read ON public.account_suspensions;
CREATE POLICY account_suspensions_staff_read ON public.account_suspensions
  FOR SELECT TO authenticated
  USING (public.is_roxy_staff());

CREATE OR REPLACE FUNCTION public.is_suspended(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.account_suspensions s
    WHERE s.user_id = p_user_id AND s.lifted_at IS NULL
  );
$$;
-- Callable by members so gate's is_approved_member() (SECURITY DEFINER) and
-- RLS expressions can use it; it answers only "is this id suspended", which
-- staff tooling shows anyway and a member learns from the account itself.
REVOKE ALL ON FUNCTION public.is_suspended(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_suspended(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.suspend_member(p_user_id uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me     uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_staff  boolean;
  v_id     uuid;
BEGIN
  IF v_me IS NULL OR NOT public.is_roxy_staff() THEN
    RAISE EXCEPTION 'Only Roxy staff can suspend a member' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Which member?' USING ERRCODE = '22023';
  END IF;
  IF p_user_id = v_me THEN
    RAISE EXCEPTION 'You cannot suspend yourself' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_reason) < 3 OR char_length(v_reason) > 2000 THEN
    RAISE EXCEPTION 'Give a reason (3 to 2000 characters)' USING ERRCODE = '22023';
  END IF;

  SELECT p.is_staff INTO v_staff FROM public.profiles p WHERE p.id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found' USING ERRCODE = 'P0002';
  END IF;
  IF coalesce(v_staff, false) AND NOT public.is_roxy_core() THEN
    RAISE EXCEPTION 'Only core staff can suspend a staff member' USING ERRCODE = '42501';
  END IF;
  IF public.is_suspended(p_user_id) THEN
    RAISE EXCEPTION 'This member is already suspended' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.account_suspensions (user_id, reason, suspended_by)
  VALUES (p_user_id, v_reason, v_me)
  RETURNING id INTO v_id;

  -- No new tokens: banned auth user, every session and refresh token gone.
  UPDATE auth.users SET banned_until = now() + interval '100 years' WHERE id = p_user_id;
  DELETE FROM auth.refresh_tokens WHERE user_id = p_user_id::text;
  DELETE FROM auth.sessions WHERE user_id = p_user_id;

  PERFORM public.staff_audit('member_suspended', 'profile', p_user_id,
    jsonb_build_object('suspension_id', v_id, 'reason', v_reason));
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.suspend_member(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suspend_member(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.unsuspend_member(p_user_id uuid, p_note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me   uuid := auth.uid();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id   uuid;
BEGIN
  -- Lifting is a second, senior pair of eyes: core staff only.
  IF v_me IS NULL OR NOT public.is_roxy_core() THEN
    RAISE EXCEPTION 'Only core staff can lift a suspension' USING ERRCODE = '42501';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 2000 THEN
    RAISE EXCEPTION 'Keep the note under 2000 characters' USING ERRCODE = '22023';
  END IF;

  UPDATE public.account_suspensions
  SET lifted_at = now(), lifted_by = v_me, lift_note = v_note
  WHERE user_id = p_user_id AND lifted_at IS NULL
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'This member is not suspended' USING ERRCODE = 'P0002';
  END IF;

  UPDATE auth.users SET banned_until = NULL WHERE id = p_user_id;

  PERFORM public.staff_audit('member_unsuspended', 'profile', p_user_id,
    jsonb_build_object('suspension_id', v_id, 'note', v_note));
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.unsuspend_member(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unsuspend_member(uuid, text) TO authenticated;

-- ── 9. Reports: resolution columns + one staff RPC (ST-01) ─────────────────
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolution_note text,
  ADD COLUMN IF NOT EXISTS resolution_action text;

-- 'reviewed' was never written by any code path (0 rows on prod); it maps to
-- 'actioned'. The old CHECK goes first or the remap itself would violate it.
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_status_check;
UPDATE public.reports SET status = 'actioned' WHERE status = 'reviewed';
ALTER TABLE public.reports ADD CONSTRAINT reports_status_check
  CHECK (status IN ('pending', 'actioned', 'dismissed'));
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_resolution_note_len;
ALTER TABLE public.reports ADD CONSTRAINT reports_resolution_note_len
  CHECK (resolution_note IS NULL OR char_length(resolution_note) <= 2000);
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_resolution_action_check;
ALTER TABLE public.reports ADD CONSTRAINT reports_resolution_action_check
  CHECK (resolution_action IS NULL OR resolution_action IN ('dismiss', 'action', 'hide'));
CREATE INDEX IF NOT EXISTS reports_pending_idx
  ON public.reports (created_at DESC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS reports_reported_user_idx
  ON public.reports (reported_user_id, created_at DESC);

-- Members file reports (submit-report uses the service role; the direct insert
-- policy stays for older builds) but never edit or resolve them.
REVOKE INSERT, UPDATE, DELETE ON public.reports FROM authenticated;
GRANT INSERT (reporter_id, reported_user_id, content_type, content_id, reason, detail)
  ON public.reports TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_resolve_report(
  p_report_id      uuid,
  p_action         text,
  p_note           text DEFAULT NULL,
  p_suspend_author boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me         uuid := auth.uid();
  v_r          public.reports%ROWTYPE;
  v_note       text := nullif(btrim(coalesce(p_note, '')), '');
  v_status     text;
  v_n          integer := 0;
  v_resolved   integer := 0;
  v_suspension uuid;
BEGIN
  IF v_me IS NULL OR NOT public.is_roxy_staff() THEN
    RAISE EXCEPTION 'Only Roxy staff can resolve reports' USING ERRCODE = '42501';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('dismiss', 'action', 'hide') THEN
    RAISE EXCEPTION 'Unknown action: use dismiss, action or hide' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 2000 THEN
    RAISE EXCEPTION 'Keep the note under 2000 characters' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_suspend_author, false) AND p_action = 'dismiss' THEN
    RAISE EXCEPTION 'A dismissed report cannot suspend anyone' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_r FROM public.reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_r.status <> 'pending' THEN
    RAISE EXCEPTION 'This report was already resolved' USING ERRCODE = '55000';
  END IF;

  IF p_action = 'hide' THEN
    IF v_r.content_id IS NULL THEN
      RAISE EXCEPTION 'This report names no content to hide; suspend the member instead' USING ERRCODE = '22023';
    END IF;
    CASE v_r.content_type
      WHEN 'post' THEN
        UPDATE public.posts SET deleted_at = now()
        WHERE id = v_r.content_id AND deleted_at IS NULL;
        GET DIAGNOSTICS v_n = ROW_COUNT;
      WHEN 'archive_entry' THEN
        UPDATE public.archive_entries SET status = 'hidden'
        WHERE id = v_r.content_id AND status <> 'hidden';
        GET DIAGNOSTICS v_n = ROW_COUNT;
      WHEN 'archive_review' THEN
        UPDATE public.archive_reviews SET status = 'removed'
        WHERE id = v_r.content_id AND status <> 'removed';
        GET DIAGNOSTICS v_n = ROW_COUNT;
      WHEN 'room' THEN
        UPDATE public.community_rooms
        SET status = 'closed', ended_at = now(), participant_count = 0
        WHERE id = v_r.content_id AND status <> 'closed';
        GET DIAGNOSTICS v_n = ROW_COUNT;
      ELSE
        -- message / profile / speed_date: removing a message is guarded by the
        -- chat lane's triggers (author or community moderator only); a profile
        -- or a speed date has nothing to hide. Suspend the member instead.
        RAISE EXCEPTION 'A % report cannot be hidden from here; action it and suspend the member', v_r.content_type
          USING ERRCODE = '22023';
    END CASE;
  END IF;

  v_status := CASE p_action WHEN 'dismiss' THEN 'dismissed' ELSE 'actioned' END;

  -- Every pending report about the same content (or, for content-less
  -- reports, this one) closes together, so the queue never shows a target
  -- staff already dealt with.
  UPDATE public.reports
  SET status = v_status,
      reviewed_by = v_me,
      resolved_by = v_me,
      resolved_at = now(),
      resolution_note = v_note,
      resolution_action = p_action
  WHERE status = 'pending'
    AND (
      id = v_r.id
      OR (v_r.content_id IS NOT NULL
          AND content_type = v_r.content_type
          AND content_id = v_r.content_id)
    );
  GET DIAGNOSTICS v_resolved = ROW_COUNT;

  IF coalesce(p_suspend_author, false) AND NOT public.is_suspended(v_r.reported_user_id) THEN
    v_suspension := public.suspend_member(
      v_r.reported_user_id,
      coalesce(v_note, 'Report ' || v_r.id::text || ': ' || v_r.reason));
  END IF;

  PERFORM public.staff_audit('report_' || p_action, 'report', v_r.id,
    jsonb_build_object(
      'content_type', v_r.content_type,
      'content_id', v_r.content_id,
      'reported_user_id', v_r.reported_user_id,
      'resolved_reports', v_resolved,
      'content_hidden', v_n > 0,
      'suspension_id', v_suspension,
      'note', v_note));

  RETURN jsonb_build_object(
    'status', v_status,
    'resolved', v_resolved,
    'hidden', v_n > 0,
    'suspension_id', v_suspension);
END $$;
REVOKE ALL ON FUNCTION public.staff_resolve_report(uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_resolve_report(uuid, text, text, boolean) TO authenticated;

-- ── 10. Payout block: core staff, audited, honest result (ST-03) ───────────
CREATE OR REPLACE FUNCTION public.staff_set_payout_block(
  p_event_id uuid,
  p_blocked  boolean,
  p_reason   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me       uuid := auth.uid();
  v_reason   text := btrim(coalesce(p_reason, ''));
  v_was      boolean;
  v_released timestamptz;
BEGIN
  IF v_me IS NULL OR NOT public.is_roxy_core() THEN
    RAISE EXCEPTION 'Only core staff can change a payout' USING ERRCODE = '42501';
  END IF;
  IF p_blocked IS NULL THEN
    RAISE EXCEPTION 'Block or unblock?' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_reason) < 3 OR char_length(v_reason) > 1000 THEN
    RAISE EXCEPTION 'Give a reason (3 to 1000 characters)' USING ERRCODE = '22023';
  END IF;

  SELECT e.payout_blocked, e.payout_released_at INTO v_was, v_released
  FROM public.events e WHERE e.id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_blocked AND v_released IS NOT NULL THEN
    RAISE EXCEPTION 'This payout was already released' USING ERRCODE = '55000';
  END IF;
  IF coalesce(v_was, false) = p_blocked THEN
    RETURN jsonb_build_object('changed', false, 'payout_blocked', p_blocked);
  END IF;

  UPDATE public.events SET payout_blocked = p_blocked WHERE id = p_event_id;
  PERFORM public.staff_audit(
    CASE WHEN p_blocked THEN 'block_payout' ELSE 'unblock_payout' END,
    'event', p_event_id, jsonb_build_object('reason', v_reason));
  RETURN jsonb_build_object('changed', true, 'payout_blocked', p_blocked);
END $$;
REVOKE ALL ON FUNCTION public.staff_set_payout_block(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_set_payout_block(uuid, boolean, text) TO authenticated;

-- ── 11. Studio read models: member search + launch funnel (ST-02, ST-05) ───
CREATE OR REPLACE FUNCTION public.staff_search_members(p_query text, p_limit integer DEFAULT 25)
RETURNS TABLE (
  id                uuid,
  username          text,
  display_name      text,
  avatar_url        text,
  vetting_status    text,
  is_staff          boolean,
  staff_role        text,
  created_at        timestamptz,
  is_deleted        boolean,
  suspended         boolean,
  suspended_at      timestamptz,
  suspension_reason text,
  reports_pending   bigint,
  reports_total     bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_q   text := btrim(coalesce(p_query, ''));
  v_lim integer := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_pat text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_roxy_staff() THEN
    RAISE EXCEPTION 'Staff only' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_q) < 2 OR char_length(v_q) > 120 THEN
    RAISE EXCEPTION 'Type 2 to 120 characters' USING ERRCODE = '22023';
  END IF;
  v_pat := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  RETURN QUERY
  SELECT p.id, p.username::text, p.display_name::text, p.avatar_url::text,
         p.vetting_status::text, coalesce(p.is_staff, false), p.staff_role::text,
         p.created_at, (p.deleted_at IS NOT NULL),
         (s.id IS NOT NULL), s.suspended_at, s.reason,
         (SELECT count(*) FROM public.reports r WHERE r.reported_user_id = p.id AND r.status = 'pending'),
         (SELECT count(*) FROM public.reports r WHERE r.reported_user_id = p.id)
  FROM public.profiles p
  LEFT JOIN public.account_suspensions s ON s.user_id = p.id AND s.lifted_at IS NULL
  WHERE p.username ILIKE v_pat ESCAPE '\'
     OR p.display_name ILIKE v_pat ESCAPE '\'
     OR p.id::text = lower(v_q)
     OR EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id AND lower(u.email) = lower(v_q))
  ORDER BY (lower(p.username) = lower(v_q)) DESC, p.created_at DESC
  LIMIT v_lim;
END $$;
REVOKE ALL ON FUNCTION public.staff_search_members(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_search_members(text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_launch_funnel()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_roxy_staff() THEN
    RAISE EXCEPTION 'Staff only' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'accounts',               (SELECT count(*) FROM auth.users),
    'profiles',               (SELECT count(*) FROM public.profiles WHERE deleted_at IS NULL),
    'applications_started',   (SELECT count(*) FROM public.membership_applications),
    'applications_submitted', (SELECT count(*) FROM public.membership_applications WHERE submitted_at IS NOT NULL),
    'applications_pending',   (SELECT count(*) FROM public.membership_applications WHERE status = 'pending' AND submitted_at IS NOT NULL),
    'approved',               (SELECT count(*) FROM public.membership_applications WHERE status = 'approved'),
    'rejected',               (SELECT count(*) FROM public.membership_applications WHERE status = 'rejected'),
    'members_approved',       (SELECT count(*) FROM public.profiles WHERE vetting_status = 'approved' AND deleted_at IS NULL),
    'suspended',              (SELECT count(*) FROM public.account_suspensions WHERE lifted_at IS NULL),
    'reports_pending',        (SELECT count(*) FROM public.reports WHERE status = 'pending'),
    'waves', coalesce((
      WITH codes AS (
        SELECT coalesce(nullif(btrim(ic.label), ''), '(no label)') AS label,
               ic.id, ic.uses_count, ic.created_at
        FROM public.invite_codes ic
      ), waves AS (
        SELECT c.label, count(*) AS codes, coalesce(sum(c.uses_count), 0) AS redemptions,
               min(c.created_at) AS first_created
        FROM codes c GROUP BY c.label
      ), apps AS (
        SELECT c.label, count(*) AS applications,
               count(*) FILTER (WHERE ma.status = 'approved') AS approved
        FROM codes c JOIN public.membership_applications ma ON ma.code_id = c.id
        GROUP BY c.label
      )
      SELECT jsonb_agg(jsonb_build_object(
               'label', w.label, 'codes', w.codes, 'redemptions', w.redemptions,
               'applications', coalesce(a.applications, 0), 'approved', coalesce(a.approved, 0),
               'first_created', w.first_created)
             ORDER BY w.first_created DESC)
      FROM waves w LEFT JOIN apps a ON a.label = w.label
    ), '[]'::jsonb)
  );
END $$;
REVOKE ALL ON FUNCTION public.staff_launch_funnel() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_launch_funnel() TO authenticated;

-- ── 12. Cron helpers (SB-07) — quiet until scripts/setup-cron.sql runs ─────
-- POST to an edge function with the service-role key, both read from Vault by
-- name. Returns the pg_net request id, or NULL when pg_net/Vault/secrets are
-- absent (a project that has not run setup keeps working exactly as before).
CREATE OR REPLACE FUNCTION public.ops_invoke_edge(p_function text, p_body jsonb DEFAULT '{}'::jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_base text;
  v_key  text;
  v_req  bigint;
BEGIN
  IF p_function IS NULL OR p_function !~ '^[a-z0-9][a-z0-9-]{0,62}$' THEN
    RAISE EXCEPTION 'Not a function name: %', p_function USING ERRCODE = '22023';
  END IF;
  IF to_regnamespace('net') IS NULL OR to_regnamespace('vault') IS NULL THEN
    RETURN NULL;
  END IF;
  EXECUTE $q$SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'roxy_functions_url'$q$ INTO v_base;
  EXECUTE $q$SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'roxy_service_role_key'$q$ INTO v_key;
  IF v_base IS NULL OR v_key IS NULL THEN
    RETURN NULL;
  END IF;
  EXECUTE $q$SELECT net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 10000)$q$
    INTO v_req
    USING rtrim(v_base, '/') || '/' || p_function,
          jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
          coalesce(p_body, '{}'::jsonb);
  RETURN v_req;
END $$;
REVOKE ALL ON FUNCTION public.ops_invoke_edge(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_invoke_edge(text, jsonb) TO service_role;

-- Run a zero-argument maintenance function only if it exists. Lets the cron
-- schedule name a job another lane is still building (e.g. an account purge)
-- without failing every minute until it lands.
CREATE OR REPLACE FUNCTION public.ops_call_if_exists(p_signature text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_signature IS NULL OR p_signature !~ '^public\.[a-z_][a-z0-9_]*\(\)$' THEN
    RAISE EXCEPTION 'Expected public.<name>(): %', p_signature USING ERRCODE = '22023';
  END IF;
  IF to_regprocedure(p_signature) IS NULL THEN
    RETURN false;
  END IF;
  EXECUTE 'SELECT ' || p_signature;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.ops_call_if_exists(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_call_if_exists(text) TO service_role;

-- Rooms left "live" forever (prod has 14 today): empty for 5 minutes after
-- start, or open longer than 12 hours, close.
CREATE OR REPLACE FUNCTION public.ops_cleanup_stale_rooms()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.community_rooms
  SET status = 'closed', ended_at = now(), participant_count = 0
  WHERE status = 'live'
    AND (
      (participant_count <= 0 AND coalesce(started_at, created_at) < now() - interval '5 minutes')
      OR coalesce(started_at, created_at) < now() - interval '12 hours'
    );
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.ops_cleanup_stale_rooms() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_cleanup_stale_rooms() TO service_role;

-- ── 13. Storage: TO authenticated + per-bucket limits (SB-11) ──────────────
-- storage.objects is owned by supabase_storage_admin. On hosted projects the
-- postgres role has been able to alter its policies (082 did), but if that
-- ever changes this warns instead of failing the whole migration; the runbook
-- carries the same statements for the SQL editor.
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
        EXECUTE format('ALTER POLICY %I ON storage.objects TO authenticated', v_name);
      END IF;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE WARNING '131: could not move storage policy % to authenticated (%); see docs/ops/launch-runbook.md', v_name, SQLERRM;
    END;
  END LOOP;
END $$;

-- Sizes: phone photos (HEIC/JPEG up to ~6 MB seen; prod max today 3.7 MB) fit
-- with headroom; logos/avatars/banners are small. No SVG or HTML anywhere: a
-- public bucket must never serve a document a browser will run.
UPDATE storage.buckets b
SET file_size_limit = v.size_limit,
    allowed_mime_types = v.mimes
FROM (VALUES
  ('avatars',        5242880::bigint,  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif']),
  ('profile-photos', 10485760::bigint, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif']),
  ('post-media',     10485760::bigint, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif']),
  ('product-photos', 10485760::bigint, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('business-logos', 2097152::bigint,  ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('room-banners',   5242880::bigint,  ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('archive-covers', 5242880::bigint,  ARRAY['image/jpeg', 'image/png', 'image/webp'])
) AS v(bucket_id, size_limit, mimes)
WHERE b.id = v.bucket_id;

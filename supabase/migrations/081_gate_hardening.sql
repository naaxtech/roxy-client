-- ============================================================
-- 081_gate_hardening.sql
--
-- Nine findings from the security pass over 069-074, fixed forward. Those files
-- are applied to production and are never edited; everything here is additive or
-- a replacement of an object they created.
--
-- The theme running through most of these: RLS decides which ROW you may write,
-- and only a GRANT decides which COLUMNS. Three of the nine are a policy that
-- was correct about rows and silent about columns, which is the same shape as
-- 070:168 (invite_codes) and 080:101 (profiles).
--
-- ── HAZARD, recorded because it has no code fix ─────────────────────────────
-- 069:108-119 and 072:100-117 both DROP+CREATE posts_select and events_select,
-- and 073:63 then replaced posts_select with the stricter announcement rule
-- (076 refined it again). The policies are keyed by NAME, not by version: if
-- 069 is ever re-run out of order -- a partial `db reset`, a cherry-picked
-- re-push, someone re-applying "just the visibility migration" -- it silently
-- reinstates its own looser USING clause and 073's tightening is gone with no
-- error, no diff, and nothing in the migrations table to show it happened. The
-- same is true of 072 for events_select.
-- The check for it is supabase/tests/069_community_visibility_check.sql Part 1,
-- which reads pg_policies rather than trusting the migration history. Run it
-- after any out-of-order push.
--
-- Retry-safe: every statement is idempotent. Re-running lands on the same ACLs,
-- the same constraints, and the same policy text.
-- ============================================================

-- ── 1. H5: comments inherited none of 073's tightening ──────────────────────
--
-- 073 made a member's post readable only by members of its community, but the
-- comment policies (069:136, 069:146) go through can_read_post, which still
-- asked only 069's question: "is this community public, or are you in it?" So
-- on a public community every member-only post was protected while its comment
-- thread stayed both readable AND writable by anyone with an account. The post
-- was locked and the conversation underneath it was not, which for a WLW app is
-- the same disclosure with an extra step.
--
-- Folding the rule into the helper rather than into each policy is deliberate --
-- it is how 072:58 already extended these functions, and it means comments,
-- likes and saves all move together instead of drifting apart again.
--
-- The clause order below mirrors 076's posts_select exactly, author clause
-- included: can_read_post gates the INSERT paths for comments and likes, so
-- without `author_id = auth.uid()` an author who posted into a public community
-- she has not joined could not comment on or like her own post -- the same
-- RETURNING-shaped break 076 was written to fix. If posts_select changes, this
-- function changes with it.
CREATE OR REPLACE FUNCTION public.can_read_post(pid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.posts p
    WHERE p.id = pid
      AND public.can_read_community_content(p.community_id)
      AND (
        p.author_id = auth.uid()
        OR p.community_id IS NULL
        OR p.posted_as_community = true
        OR public.is_community_member(p.community_id)
      )
  );
$$;

COMMENT ON FUNCTION public.can_read_post(uuid) IS
  'True when the caller may read this post: announcement, own post, uncommunitied post, or a community she is in. Must stay in step with posts_select (073/076) -- comments, likes and saves all reach posts through this function, so a divergence here reopens on comments whatever posts_select closed.';

-- Unchanged in body, restated so the delegation is on the record: a comment is
-- readable exactly when its post is, so it inherited the fix above the moment
-- can_read_post was replaced. Anyone rewriting this to query posts directly
-- takes on the whole visibility rule and will get it wrong.
CREATE OR REPLACE FUNCTION public.can_read_comment(cmid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.comments c
    WHERE c.id = cmid
      AND public.can_read_post(c.post_id)
  );
$$;

COMMENT ON FUNCTION public.can_read_comment(uuid) IS
  'True when the caller may read this comment. Delegates to can_read_post on purpose -- a comment must never be more visible than the post it hangs off.';

-- ── 2. H1: an applicant could award herself the ID checks ───────────────────
--
-- ans_own (071:156) let her insert an application_answers row naming ANY
-- criterion, and sync_answer_criterion (071:182) is an AFTER INSERT trigger
-- that marks whatever criterion the row names as met. Two PostgREST calls
-- naming gov_id and kyc_liveness and she is scored as identity-verified without
-- a vendor session ever existing -- and the reviewer's queue shows the same
-- number the honest applicant earned. It also crossed communities: nothing
-- required the criterion to belong to the community she applied to.
--
-- The narrow fix is "questions only", and it is wrong. The shipped applicant
-- screen routes every non-KYC, non-legal-name criterion through saveAnswer --
-- apps/mobile/app/(auth)/application.tsx:92, via store/gateStore.ts:272 -- and
-- the seeded social_account criterion (071:104) is kind='attribute'. A
-- questions-only rule would break the social handle field for every applicant.
--
-- So the boundary is made explicit instead of inferred from `kind`: a criterion
-- says whether an applicant's own word satisfies it. It defaults to false, so a
-- criterion added later from the studio -- the exact case where nobody is
-- reading this file -- fails closed and cannot be self-awarded.
ALTER TABLE public.verification_criteria
  ADD COLUMN IF NOT EXISTS self_attestable boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.verification_criteria.self_attestable IS
  'May the applicant satisfy this criterion by her own statement? Questions always may. An attribute may only if this is true -- gov_id and kyc_liveness must never be, they are awarded by the KYC webhook on the service role. Default false so a new criterion is safe before anyone thinks about it.';

-- A social handle is the one attribute the applicant supplies herself: it is
-- evidence a reviewer reads and judges, not a check we are asserting passed.
-- Scoped to the global seed row -- a community that mints its own criterion
-- with this key gets the default and has to opt in deliberately.
UPDATE public.verification_criteria
SET self_attestable = true
WHERE key = 'social_account' AND community_id IS NULL AND self_attestable = false;

-- One definition of the boundary, so the RPC that eventually replaces the
-- client's direct writes to application_criteria_met can enforce the same rule
-- rather than inventing a second one that drifts.
CREATE OR REPLACE FUNCTION public.can_self_attest_criterion(
  p_application_id uuid,
  p_criterion_id   uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.membership_applications a
    JOIN public.verification_criteria c ON c.id = p_criterion_id
    WHERE a.id = p_application_id
      AND a.auth_user_id = auth.uid()
      -- Answers are part of applying. After a decision the record is evidence.
      AND a.status = 'pending'
      AND c.is_active = true
      -- Global criteria, or her own community's. Another community's question
      -- is not hers to answer, and application_score (071:237) sums every met
      -- criterion regardless of scope, so scoring one would have paid.
      AND (c.community_id IS NULL OR c.community_id = a.community_id)
      AND (c.kind = 'question' OR c.self_attestable = true)
  );
$$;

COMMENT ON FUNCTION public.can_self_attest_criterion(uuid, uuid) IS
  'Gate for anything the applicant writes that scores her own application. Own pending application, active criterion, in scope for her community, and self-attestable. Any future write path onto application_criteria_met must call this.';

GRANT EXECUTE ON FUNCTION public.can_self_attest_criterion(uuid, uuid) TO authenticated;

-- USING is unchanged: she may still read, correct and delete her own answers.
-- Only what she may CREATE narrows.
DROP POLICY IF EXISTS "ans_own" ON public.application_answers;
CREATE POLICY "ans_own" ON public.application_answers
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.membership_applications a
      WHERE a.id = application_answers.application_id
        AND a.auth_user_id = auth.uid()
    )
  )
  WITH CHECK (
    public.can_self_attest_criterion(application_id, criterion_id)
  );

-- ── 3. H2 + M7: membership_applications was column-blind in both directions ──
--
-- H2 -- ma_withdraw_own (070:341) correctly restricts the applicant to her own
-- pending row and says nothing about columns, and there has never been a
-- column GRANT on this table. Supabase's default table-wide grant therefore let
-- her PATCH her own row and rewrite community_id (reassign herself to a
-- community that never issued her a code, and whose admins now see her Art. 9
-- data), code_id (break attribution to the code that admitted her), or
-- submitted_at (backdate herself to the front of the review queue, and past
-- overflow_after_days into a stranger's overflow queue).
--
-- M7 -- ma_update_reviewer (070:334) gave reviewers UPDATE on the same table.
-- The comment there assumed the RPC was the only path because it is the only
-- thing that knows how to write application_reviews, but a reviewer with a REST
-- client could PATCH status='approved' directly: no application_reviews row, no
-- decided_by, no note, no cooldown, no purge_after -- and no email, because
-- trg_application_email (072:176) fires on the status change but the profile
-- flip and community join in _apply_decision never run. She is told she is in
-- while vetting_status stays 'pending' and every policy still denies her.
-- The policy goes. decide_application (071:530) is SECURITY DEFINER and does
-- not need it, which is verified by the studio being the only reviewer client
-- and already calling the RPC (apps/studio/.../ReviewQueueClient.tsx:145).
REVOKE UPDATE ON public.membership_applications FROM anon, authenticated;

-- Withdrawal is hers, and it is the only column a client may ever write here.
-- ma_withdraw_own still constrains the value to 'pending' or 'withdrawn'.
GRANT UPDATE (status) ON public.membership_applications TO authenticated;

DROP POLICY IF EXISTS "ma_update_reviewer" ON public.membership_applications;

-- ── 4. M4: a reviewer could delete her own Art. 9 audit trail ───────────────
-- application_access_log.viewer_id was ON DELETE CASCADE to profiles, so
-- deleting the account deleted the record of every legal name that account had
-- revealed. An audit log that the audited party can erase by leaving is not an
-- audit log. SET NULL keeps what happened, to whose application, and when --
-- and the identity is recoverable from the deletion record anyway.
DO $$
DECLARE v_name text;
BEGIN
  FOR v_name IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.application_access_log'::regclass
      AND con.contype = 'f'
      AND con.conkey::smallint[] = ARRAY[
        (SELECT attnum FROM pg_attribute
         WHERE attrelid = 'public.application_access_log'::regclass
           AND attname = 'viewer_id' AND NOT attisdropped)
      ]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE public.application_access_log DROP CONSTRAINT %I', v_name);
  END LOOP;
END;
$$;

ALTER TABLE public.application_access_log ALTER COLUMN viewer_id DROP NOT NULL;

ALTER TABLE public.application_access_log
  ADD CONSTRAINT application_access_log_viewer_id_fkey
  FOREIGN KEY (viewer_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.application_access_log.viewer_id IS
  'NULL means the viewer account has since been deleted. The row survives on purpose -- this is the Art. 9 access record and it must outlive the person it records.';

-- ── 5. M5: deleting one admin destroyed a community's invite history ────────
-- invite_codes.created_by was NOT NULL ON DELETE CASCADE, so removing an
-- account deleted every code she ever minted. Those rows are the attribution
-- the whole gate exists to create: membership_applications.code_id is ON DELETE
-- SET NULL (070:223), so the cascade silently detached every member she
-- admitted from the code that admitted them, and profiles.admitted_via_code_id
-- pointed at nothing. One departing admin, and the community can no longer
-- answer "who vouched for her".
DO $$
DECLARE v_name text;
BEGIN
  FOR v_name IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.invite_codes'::regclass
      AND con.contype = 'f'
      AND con.conkey::smallint[] = ARRAY[
        (SELECT attnum FROM pg_attribute
         WHERE attrelid = 'public.invite_codes'::regclass
           AND attname = 'created_by' AND NOT attisdropped)
      ]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE public.invite_codes DROP CONSTRAINT %I', v_name);
  END LOOP;
END;
$$;

ALTER TABLE public.invite_codes ALTER COLUMN created_by DROP NOT NULL;

ALTER TABLE public.invite_codes
  ADD CONSTRAINT invite_codes_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ic_insert_admin (070:140) still requires created_by = auth.uid() on INSERT,
-- so nothing can create an unattributed code. NULL only ever arrives later, and
-- only by the creator's account being deleted.
COMMENT ON COLUMN public.invite_codes.created_by IS
  'NULL means the issuing account has since been deleted; the code and everyone it admitted stay attributable to the community. Never NULL at insert time -- ic_insert_admin requires auth.uid().';

-- ── 6. M6: one safety row per person, platform-wide ─────────────────────────
--
-- Two defects in one table.
--
-- The key. member_safety was PRIMARY KEY (user_id) with community_id as an
-- ordinary column, so the table holds exactly one row per member no matter how
-- many communities she is in. The first community to rate her owns the row;
-- every other community's admin hits a primary-key conflict on insert and is
-- then denied by ms_own_community's USING clause on the conflicting row, which
-- names a community they do not administer. So the failure mode is not the
-- overwrite it looks like -- it is worse and quieter: a community that has a
-- genuine safety concern about a shared member simply cannot record it, and the
-- error it gets back is a key violation that reads like a bug.
--
-- The subject. Nothing required the rated user to be a member of the community
-- doing the rating. An admin of any community could write a watchlist row with
-- a reason attached about any account on the platform, and staff read every one
-- of them cross-community. A defamation-adjacent record about a stranger, from
-- someone with no relationship to her.
--
-- community_id must become NOT NULL to sit in the key, which also fixes its FK:
-- ON DELETE SET NULL would have orphaned ratings into an unscoped state that no
-- policy can reach. A rating is scoped to the community that made it, so it
-- dies with that community.

-- Rows with no community are already unreachable through ms_own_community,
-- which requires community_id IS NOT NULL in both USING and WITH CHECK. They
-- cannot be created by any client path today and there is no community to
-- attribute them to, so they cannot enter the new key.
DO $$
DECLARE v_orphans integer;
BEGIN
  SELECT count(*) INTO v_orphans FROM public.member_safety WHERE community_id IS NULL;
  IF v_orphans > 0 THEN
    DELETE FROM public.member_safety WHERE community_id IS NULL;
    RAISE NOTICE
      'member_safety: removed % unscoped row(s) with no community_id -- they were unreadable and unwritable through RLS',
      v_orphans;
  END IF;
END;
$$;

DO $$
DECLARE v_name text;
BEGIN
  -- Primary key first: the composite one cannot be added while the single-column
  -- key exists, and community_id cannot be made NOT NULL while its SET NULL
  -- foreign key contradicts it.
  FOR v_name IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.member_safety'::regclass
      AND con.contype = 'p'
  LOOP
    EXECUTE format('ALTER TABLE public.member_safety DROP CONSTRAINT %I', v_name);
  END LOOP;

  FOR v_name IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.member_safety'::regclass
      AND con.contype = 'f'
      AND con.conkey::smallint[] = ARRAY[
        (SELECT attnum FROM pg_attribute
         WHERE attrelid = 'public.member_safety'::regclass
           AND attname = 'community_id' AND NOT attisdropped)
      ]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE public.member_safety DROP CONSTRAINT %I', v_name);
  END LOOP;
END;
$$;

ALTER TABLE public.member_safety ALTER COLUMN community_id SET NOT NULL;

ALTER TABLE public.member_safety
  ADD CONSTRAINT member_safety_community_id_fkey
  FOREIGN KEY (community_id) REFERENCES public.communities(id) ON DELETE CASCADE;

ALTER TABLE public.member_safety
  ADD CONSTRAINT member_safety_pkey PRIMARY KEY (user_id, community_id);

COMMENT ON TABLE public.member_safety IS
  'One safety record per member PER COMMUNITY. The key is composite deliberately: a rating is one community''s judgement, and a single-row-per-user key silently prevented a second community from recording its own.';

-- The reviewer test in USING is 070:527 unchanged (community_id IS NOT NULL is
-- now carried by the column constraint). WITH CHECK gains the subject test.
--
-- Applied to WITH CHECK only, never to USING: a member who leaves -- or is
-- removed for the very behaviour the row records -- must not take the record
-- with her by dropping out of the membership test. New rows require a
-- relationship; existing rows stay readable and correctable by the community
-- that wrote them.
DROP POLICY IF EXISTS "ms_own_community" ON public.member_safety;
CREATE POLICY "ms_own_community" ON public.member_safety
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.community_members m
      JOIN public.profiles p ON p.id = auth.uid()
      LEFT JOIN public.reviewer_settings rs ON rs.user_id = auth.uid()
      WHERE m.community_id = member_safety.community_id
        AND m.user_id = auth.uid()
        AND m.role IN ('admin','border_patrol')
        AND p.vetting_status = 'approved'
        AND rs.reviewer_agreement_at IS NOT NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.community_members m
      JOIN public.profiles p ON p.id = auth.uid()
      LEFT JOIN public.reviewer_settings rs ON rs.user_id = auth.uid()
      WHERE m.community_id = member_safety.community_id
        AND m.user_id = auth.uid()
        AND m.role IN ('admin','border_patrol')
        AND p.vetting_status = 'approved'
        AND rs.reviewer_agreement_at IS NOT NULL
    )
    AND EXISTS (
      SELECT 1 FROM public.community_members subject
      WHERE subject.community_id = member_safety.community_id
        AND subject.user_id = member_safety.user_id
    )
  );

-- ── 7. L1: the rate limiter published its own thresholds ────────────────────
-- gs_read was USING (true), so any authenticated account could read
-- code_attempt_limit, code_lock_threshold and global_attempts_per_min -- the
-- exact numbers to stay under while grinding invite codes, and the exact number
-- to exceed to lock a rival community's code out of the signup flow. Nothing in
-- either app reads this table (grepped apps/mobile and apps/studio); every
-- server-side reader -- validate_invite_code (071:298), _apply_decision
-- (071:484), can_review_application (070:303) -- is SECURITY DEFINER and so is
-- unaffected by RLS here. If a client surface ever needs overflow_after_days,
-- it gets a view exposing that column only, not this policy widened again.
DROP POLICY IF EXISTS "gs_read" ON public.gate_settings;
CREATE POLICY "gs_read" ON public.gate_settings
  FOR SELECT TO authenticated
  USING (public.is_roxy_staff());

-- ── 8. L2: has_consent answered for any user id ─────────────────────────────
-- 074:168 granted EXECUTE to authenticated on has_consent(uuid, text), which
-- takes the subject from its argument. Any account could ask whether any other
-- account had consented to identity verification, AI training or marketing --
-- and worse than the finding says: Supabase's default privileges also grant
-- EXECUTE to anon, so the shipped publishable key could ask it too, without a
-- session, one uuid at a time.
--
-- No client calls it. The only caller is kyc-create-session (index.ts:64), which
-- runs on the service role -- getSupabaseClient() in functions/_shared/auth.ts
-- is the service-role client -- so it keeps working, and the grant below makes
-- that dependency explicit instead of resting on default privileges. The two
-- triggers that call it (074:174 assert_verification_consent, and the Art. 28
-- gate) are SECURITY DEFINER and execute as the owner, so they are unaffected.
--
-- A user's own consent state stays readable without this function: consent_events
-- has ce_read_own (074:141).
REVOKE ALL ON FUNCTION public.has_consent(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_consent(uuid, text) TO service_role;

COMMENT ON FUNCTION public.has_consent(uuid, text) IS
  'Server-side only: takes the subject as an argument, so it must never be callable by a client role. Called by kyc-create-session on the service role and by the consent triggers as owner.';

-- ── 9. L8: editing a post rewrote the community's announcement date ─────────
--
-- set_announced_on (073:35) assigned announced_on unconditionally, and its
-- trigger fired on any UPDATE that merely NAMED posted_as_community -- PostgREST
-- puts every column of the payload in the SET list, so a plain edit that echoes
-- the post back qualifies. An announcement from last week edited today became
-- an announcement dated today: it either burned the community's one slot for
-- the day, or collided with the announcement they had already published and
-- failed on uq_community_announcement_per_day with a raw key violation.
--
-- The trigger now fires on every UPDATE rather than only on updates naming that
-- column. It is not tidiness: `authenticated` holds table-wide UPDATE on posts,
-- so a client could PATCH announced_on directly, skip the trigger entirely, and
-- move an existing announcement off today's date to free the slot for a second
-- one. Firing on every update means the column is always recomputed from the
-- rule below and a directly-supplied value is discarded. The cost is one
-- assignment per post update, which is cheaper than the column grant audit that
-- the alternative fix would need across every posts write path.
CREATE OR REPLACE FUNCTION public.set_announced_on()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.announced_on := CASE
      WHEN NEW.posted_as_community THEN (now() AT TIME ZONE 'UTC')::date
      ELSE NULL
    END;
    RETURN NEW;
  END IF;

  IF NOT NEW.posted_as_community THEN
    -- Demoted, or never was one. The slot is released; the partial unique index
    -- ignores the row from here anyway.
    NEW.announced_on := NULL;
  ELSIF OLD.posted_as_community AND OLD.announced_on IS NOT NULL THEN
    -- Already an announcement: it keeps the day it was published on, whatever
    -- the payload says.
    NEW.announced_on := OLD.announced_on;
  ELSE
    -- The only transition that takes a slot: not an announcement before, is one
    -- now (or was one with no date, which no path produces but would otherwise
    -- leave it NULL and outside the daily cap).
    NEW.announced_on := (now() AT TIME ZONE 'UTC')::date;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_announced_on ON public.posts;
CREATE TRIGGER trg_set_announced_on
  BEFORE INSERT OR UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.set_announced_on();

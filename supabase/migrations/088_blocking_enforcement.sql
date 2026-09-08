-- ============================================================
-- 088_blocking_enforcement.sql
--
-- The block button has been a lie since 085 made it work.
--
-- 085 gave block_user() an entry point and blocked_user_ids() a way to
-- rehydrate the list. Both work. Nothing reads the result.
--
--   store/safetyStore.ts:56          fills blockedUserIds from the RPC
--   app/(tabs)/_layout.tsx:50        calls loadBlockedUsers() on sign-in
--   store/safetyStore.ts:63          uses it as a dedupe guard inside blockUser
--
-- That is every reference in the codebase. No feed query, no chat query and no
-- profile query filters on it, and until this file no RLS policy on posts,
-- comments, conversations, messages or profiles mentioned status='blocked' at
-- all -- 'blocked' appears in exactly one migration (085) outside the CHECK
-- constraint that defines it (003:85).
--
-- So components/feed/FeedSafetySheet.tsx:119 announces
--
--     "Blocked {name}. You will not see each other here."
--
-- and then: she keeps seeing his posts in the same feed, he can still open a DM
-- with her through lib/directMessages.ts, and both profiles stay mutually
-- visible. The only real effect of pressing block was the DELETE at 085:82 --
-- a silent unfriend. On a WLW dating app that is the worst possible failure
-- mode for this control: it tells a woman she is safe and then leaves her
-- exactly where she was, minus the evidence that they were ever connected.
--
-- WHY THIS IS RLS AND NOT A CLIENT FILTER.
--   The publishable key ships inside apps/mobile/eas.json. Anything the client
--   filters out is still fetchable by anyone holding that key and a session.
--   A block that lives in the client is a block that survives exactly as long
--   as nobody looks. 087 already made this argument about badges; it applies
--   with far more force to a safety control.
--
-- SYMMETRY IS THE PRODUCT DECISION.
--   blocked_pair() is deliberately symmetric: one row hides content in BOTH
--   directions. friendships is keyed UNIQUE (requester_id, addressee_id), so a
--   block is one directed row -- if the policies only read it in the direction
--   it was written, the woman who blocked him would stop seeing him while he
--   went on watching her. That is not what the sheet promises, and it is not
--   what blocking means anywhere else in this category.
--
-- WHERE THE HELPERS ARE WIRED, AND WHY THERE.
--   posts_select        the feed
--   can_read_post       comments, likes and saves all reach posts through this
--                       function (081:71 makes that contract explicit), so the
--                       block clause has to go here or a hidden post keeps a
--                       readable comment thread hanging off it
--   comments_select     a comment by a blocked author under a post that is
--                       still perfectly readable
--   profiles_select_public   the profile screen, and every `profiles(...)`
--                       embed that POST_WITH_AUTHOR pulls in
--   conversations / messages   both, and on FOR ALL rather than SELECT alone:
--                       "he can still open a DM with her" is an INSERT, so a
--                       read-only fix would leave the harm intact and merely
--                       make its result invisible
--
-- WHAT IS DELIBERATELY NOT CHANGED.
--   posts_select_staff / comments_select_staff (069:117, 069:140) keep their
--   own unfiltered permissive policies. The reports queue must render reported
--   content regardless of who the reviewing staff member has personally
--   blocked; a moderation surface that can be disabled by blocking the person
--   you are moderating is a worse safety hole than the one this file closes.
--   Residual, stated plainly: a staff account's own feed still shows posts by
--   people it has blocked, because permissive policies are OR'd. Staff are two
--   people today. If that ever stops being true, the fix is to move the reports
--   queue onto the service role and drop the two _staff policies -- not to add
--   an is_roxy_staff() exemption inside blocked_pair, which would make the
--   helper lie in a different direction.
--
--   There is no unblock path. 085 did not ship one and this file does not
--   invent one; a DELETE on the friendships row reverses everything here.
--
-- Retry-safe: CREATE OR REPLACE / DROP POLICY IF EXISTS / CREATE INDEX IF NOT
-- EXISTS throughout, per 070, 080, 082 and 086.
-- ============================================================

-- ── 1. The index the policies run on ────────────────────────────────────────
--
-- blocked_pair() is called once per candidate row on every feed read, every
-- comment thread and every profile embed, and it is SECURITY DEFINER with a
-- pinned search_path -- both of which make it un-inlinable, so it really is a
-- function call per row rather than a predicate the planner folds away. The
-- only lever left is making the lookup inside it as close to free as possible.
--
-- Two partial indexes, not one, and not the existing pair:
--   idx_friendships_requester (003:97) is (requester_id, status) -- it can find
--   the a->b direction but has to visit the heap to test addressee_id.
--   idx_friendships_addressee (003:96) is (addressee_id, status) -- same
--   problem mirrored. Neither can answer either direction from the index alone.
--
-- These two carry both uuids in both orders, so each arm of the OR inside
-- blocked_pair() is one index probe with no heap access. WHERE status =
-- 'blocked' keeps them to the blocked rows only -- a rounding error next to
-- pending + accepted friendships -- so they stay resident in cache, which is
-- the property that actually matters for something on the feed's hot path.
--
-- Plain column indexes rather than a single LEAST/GREATEST expression index on
-- the normalised pair: the expression form would be one index instead of two,
-- but MinMaxExpr immutability in an index definition is not something this
-- migration can verify without executing it, and a migration that fails to
-- apply is worth less than an index that costs 8kB more.
CREATE INDEX IF NOT EXISTS idx_friendships_blocked_fwd
  ON public.friendships (requester_id, addressee_id)
  WHERE status = 'blocked';

CREATE INDEX IF NOT EXISTS idx_friendships_blocked_rev
  ON public.friendships (addressee_id, requester_id)
  WHERE status = 'blocked';

COMMENT ON INDEX public.idx_friendships_blocked_fwd IS
  'Supports the a->b arm of blocked_pair(). Partial on status=''blocked'' so it stays tiny and cached: this is on the feed read path.';

COMMENT ON INDEX public.idx_friendships_blocked_rev IS
  'Supports the b->a arm of blocked_pair(). Blocking is symmetric but the row is directed, so the reverse order is a separate probe, not the same one.';


-- ── 2. blocked_pair ─────────────────────────────────────────────────────────
--
-- SECURITY DEFINER because friendships_own (003:93) would otherwise hide the
-- very row we are testing: it is USING (auth.uid() IN (requester_id,
-- addressee_id)), which is true for both parties to a block, but a policy that
-- depended on another table's RLS being permissive is a policy waiting to be
-- broken by an unrelated tightening. Reading it as the owner makes the answer
-- independent of who is asking.
--
-- EXISTS, never a comparison: sender_id on messages is ON DELETE SET NULL
-- (004:33), so b is genuinely NULL for a message from a deleted account.
-- `a = NULL` is NULL, `NOT NULL` is NULL, and a policy that evaluates to NULL
-- filters the row out -- which would silently disappear the history of every
-- woman who has left. EXISTS returns false, never NULL, so those rows stay.
--
-- The a <> b guard is the same argument applied to the common case rather than
-- the rare one: no_self_friendship (003:88) already makes a self-block
-- impossible, so the EXISTS could never be true, and skipping it saves two
-- index probes on every row a woman wrote herself. Written as an AND chain
-- rather than an early RETURN so that a NULL argument yields false at the first
-- operand instead of propagating.
CREATE OR REPLACE FUNCTION public.blocked_pair(a uuid, b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a IS NOT NULL
     AND b IS NOT NULL
     AND a <> b
     AND EXISTS (
       SELECT 1
       FROM public.friendships f
       WHERE f.status = 'blocked'
         AND (
           (f.requester_id = a AND f.addressee_id = b)
           OR
           (f.requester_id = b AND f.addressee_id = a)
         )
     );
$$;

-- RLS policy expressions are evaluated with the querying role's privileges, so
-- authenticated genuinely needs EXECUTE here -- without it every SELECT on
-- posts fails with 42501 instead of returning rows. anon gets nothing: it holds
-- no permissive SELECT policy on any of the five tables below, so it has no
-- reason to reach this function, and the publishable key in eas.json is an anon
-- key.
REVOKE ALL ON FUNCTION public.blocked_pair(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.blocked_pair(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.blocked_pair(uuid, uuid) IS
  'True when either party has blocked the other. Symmetric by design: friendships stores one directed row, and reading it in one direction only would leave the blocked party still watching. Returns false (never NULL) for a NULL argument so messages from deleted accounts survive.';


-- ── 3. blocked_in_conversation ──────────────────────────────────────────────
--
-- A conversation is a uuid[] of participants, so the question "is anyone in
-- this thread blocked to me" is not expressible as a single blocked_pair()
-- call. Defining it once here rather than inlining an unnest into two policies
-- keeps conversations and messages from drifting apart -- which is the failure
-- 081:71 documents for can_read_post and posts_select.
--
-- SECURITY DEFINER for a second reason on top of the friendships one: the
-- messages policy has to read conversations, and doing that through an
-- owner-privileged function is what keeps RLS on conversations out of the
-- evaluation of RLS on messages entirely. No recursion, no ordering question.
--
-- Applied to every conversation_type, including group speed_date and sister
-- threads. Blocking someone and then sharing a room with them is the outcome
-- the sheet's wording rules out, and a partial block is harder to explain to a
-- frightened user than a total one.
CREATE OR REPLACE FUNCTION public.blocked_in_conversation(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversations c,
         unnest(c.participant_ids) AS participant_id
    WHERE c.id = p_conversation_id
      AND public.blocked_pair(auth.uid(), participant_id)
  );
$$;

REVOKE ALL ON FUNCTION public.blocked_in_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.blocked_in_conversation(uuid) TO authenticated;

COMMENT ON FUNCTION public.blocked_in_conversation(uuid) IS
  'True when any participant of this conversation is block-paired with the caller. The single definition behind both the conversations and messages policies -- keep them reading this, not their own unnest.';


-- ── 4. posts ────────────────────────────────────────────────────────────────
--
-- 076's body reproduced exactly, with one clause added. Every line below the
-- marker is 076 unchanged, which is 073 unchanged before it: is_approved_member
-- is the invite gate (072), the author clause is what keeps INSERT ... RETURNING
-- working (076's whole reason for existing), posted_as_community is
-- announcements (073), and is_community_member is the private-community rule
-- (069). Dropping any of them here would quietly reopen a hole that took four
-- migrations to close.
--
-- The block clause sits OUTSIDE the OR group on purpose. Inside it, the
-- `author_id = auth.uid()` branch would satisfy the policy on its own and a
-- blocked author's post would come back the moment it was also her own -- which
-- is never, but the shape is wrong and the next person to edit this would
-- inherit the mistake. Outside, it is unconditional. blocked_pair(x, x) is
-- false, so her own posts are unaffected.
DROP POLICY IF EXISTS "posts_select" ON public.posts;

CREATE POLICY "posts_select" ON public.posts
  FOR SELECT TO authenticated
  USING (
    public.is_approved_member()
    AND NOT public.blocked_pair(auth.uid(), author_id)   -- new in 088
    AND (
      -- Everything below this line is 076 unchanged.
      author_id = auth.uid()
      OR community_id IS NULL
      OR posted_as_community = true
      OR public.is_community_member(community_id)
    )
  );

COMMENT ON POLICY "posts_select" ON public.posts IS
  'Announcements reach every approved member; member posts require membership; an author can always read her own post; and a blocked pair sees none of each other''s, in either direction. Dropping the author clause breaks INSERT ... RETURNING (076); dropping the block clause makes FeedSafetySheet''s promise false again (088).';


-- ── 5. can_read_post, and everything hanging off it ─────────────────────────
--
-- 081:48 states the contract: "If posts_select changes, this function changes
-- with it." This is that change. comments_select, comments_insert, pl_select
-- and ps_select all reach posts exclusively through can_read_post, so without
-- this the post vanishes from the feed while its comment thread, its like rows
-- and its saved-post entry stay readable -- a hidden post with a visible
-- conversation under it is not hidden.
--
-- It gates the INSERT paths too, and that is wanted rather than tolerated:
-- after a block she cannot comment on or like his posts, and he cannot comment
-- on or like hers. A block that stopped reading but permitted writing would
-- leave him able to keep appearing under her name.
CREATE OR REPLACE FUNCTION public.can_read_post(pid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.posts p
    WHERE p.id = pid
      AND public.can_read_community_content(p.community_id)
      AND NOT public.blocked_pair(auth.uid(), p.author_id)   -- new in 088
      AND (
        p.author_id = auth.uid()
        OR p.community_id IS NULL
        OR p.posted_as_community = true
        OR public.is_community_member(p.community_id)
      )
  );
$$;

COMMENT ON FUNCTION public.can_read_post(uuid) IS
  'True when the caller may read this post: announcement, own post, uncommunitied post, or a community she is in -- and never when the pair is blocked. Must stay in step with posts_select (073/076/088); comments, likes and saves all reach posts through this function, so a divergence here reopens on comments whatever posts_select closed.';


-- ── 6. comments ─────────────────────────────────────────────────────────────
--
-- Section 5 handles "the post is by someone I blocked". This handles the other
-- half: a comment by a blocked author under a post that is entirely readable --
-- an announcement, a community post, her own post. He can still reach her
-- there otherwise, which is the more likely shape of the harm.
--
-- 069's delegation to can_read_post is preserved verbatim; only the author
-- clause is new.
DROP POLICY IF EXISTS "comments_select" ON public.comments;

CREATE POLICY "comments_select" ON public.comments
  FOR SELECT TO authenticated
  USING (
    public.can_read_post(post_id)
    AND NOT public.blocked_pair(auth.uid(), author_id)   -- new in 088
  );

COMMENT ON POLICY "comments_select" ON public.comments IS
  'A comment is readable when its post is (069) and its author is not block-paired with the caller (088). The second clause is not redundant: can_read_post only knows about the POST''s author, so without it a blocked man still comments under an announcement she can see.';

-- The write side of the same rule. can_read_post now carries the block, so
-- this policy inherits it with no textual change -- restated here only so the
-- inheritance is on the record and nobody "simplifies" it later.
DROP POLICY IF EXISTS "comments_insert" ON public.comments;

CREATE POLICY "comments_insert" ON public.comments
  FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND public.can_read_post(post_id)
  );


-- ── 7. profiles ─────────────────────────────────────────────────────────────
--
-- 080's audience fix and its predicate, unchanged, plus the block. This is what
-- makes "you will not see each other here" true of the profile screen
-- (app/(tabs)/profile/[userId].tsx) and of every `profiles(...)` embed --
-- POST_WITH_AUTHOR pulls one into each feed row, and PostgREST applies the
-- embedded table's own policies, so an unfiltered profiles would keep handing
-- back his name and avatar next to content that had already been hidden.
--
-- profiles_select_own (080:165) is untouched and still permissive, so a woman
-- always reads her own row: blocked_pair(x, x) is false, and even if it were
-- not, the own-row policy ORs in ahead of this one.
DROP POLICY IF EXISTS "profiles_select_public" ON public.profiles;

CREATE POLICY "profiles_select_public" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    is_active = true
    AND is_ghost = false
    AND NOT public.blocked_pair(auth.uid(), id)   -- new in 088
  );

COMMENT ON POLICY "profiles_select_public" ON public.profiles IS
  'Active, non-ghost profiles, to authenticated only (080), and never a profile the caller is block-paired with (088). profiles_select_own is the separate permissive policy that keeps a woman''s own row readable regardless.';


-- ── 8. conversations ────────────────────────────────────────────────────────
--
-- Three changes to 004:23, and the middle one is the one that matters.
--
--   TO authenticated   004 wrote this with no TO clause, which is TO PUBLIC and
--                      therefore includes anon. It was never exploitable --
--                      auth.uid() is NULL for anon and `NULL = ANY(...)` is
--                      NULL, so no row ever matched -- but 080:159 and 082 have
--                      both already had to make exactly this argument about
--                      exactly this omission, and this project has shipped
--                      three production leaks from a missing TO clause. It
--                      stops resting on a NULL-comparison accident here.
--
--   the block clause   on FOR ALL, not FOR SELECT. Opening a DM is an INSERT
--                      (lib/directMessages.ts:26). A read-only fix would let
--                      him create the conversation and then hide it from both
--                      of them, which is worse than refusing it: the row would
--                      still occupy the unique pair slot from 058, so if she
--                      later unblocked him the thread would reappear with
--                      whatever he had queued into it.
--
--   explicit WITH CHECK  004 had none, so Postgres reused USING for it. That
--                      produced the right constraint by accident and would go
--                      on doing so, but 080:178 makes the case: the moment
--                      USING is widened the implicit WITH CHECK widens with it,
--                      silently. Written out so it cannot.
DROP POLICY IF EXISTS "conversations_participant" ON public.conversations;

CREATE POLICY "conversations_participant" ON public.conversations
  FOR ALL TO authenticated
  USING (
    auth.uid() = ANY (participant_ids)
    AND NOT public.blocked_in_conversation(id)   -- new in 088
  )
  WITH CHECK (
    auth.uid() = ANY (participant_ids)
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(participant_ids) AS participant_id
      WHERE public.blocked_pair(auth.uid(), participant_id)
    )
  );

COMMENT ON POLICY "conversations_participant" ON public.conversations IS
  'Participants only, authenticated only, and never a thread containing someone the caller is block-paired with -- on FOR ALL, because opening a DM is an INSERT and refusing the read alone would leave the row created. WITH CHECK unnests the incoming row directly rather than calling blocked_in_conversation(id), which cannot see a row that does not exist yet.';


-- ── 9. messages ─────────────────────────────────────────────────────────────
--
-- The conversation-level guard is the real one -- once the thread is gone, the
-- messages in it are unreachable through every surface in the app. The
-- sender-level guard on top of it is for the shape conversations cannot
-- express: a group speed_date or sister thread that survives for the others,
-- carrying his words inside it.
--
-- All three policies gain TO authenticated for the reason in section 8.
DROP POLICY IF EXISTS "messages_participant" ON public.messages;

CREATE POLICY "messages_participant" ON public.messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND auth.uid() = ANY (c.participant_ids)
    )
    AND NOT public.blocked_in_conversation(conversation_id)      -- new in 088
    AND NOT public.blocked_pair(auth.uid(), sender_id)           -- new in 088
  );

COMMENT ON POLICY "messages_participant" ON public.messages IS
  'A participant reads a thread unless it contains someone she is block-paired with, and never reads a message sent by one. The sender clause is the group-thread case; blocked_pair returns false for a NULL sender_id (ON DELETE SET NULL) so messages from deleted accounts are not swept up with it.';

DROP POLICY IF EXISTS "messages_insert_participant" ON public.messages;

CREATE POLICY "messages_insert_participant" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND auth.uid() = ANY (c.participant_ids)
    )
    AND NOT public.blocked_in_conversation(conversation_id)      -- new in 088
  );

COMMENT ON POLICY "messages_insert_participant" ON public.messages IS
  'Sending into a thread you are in, unless it holds someone you are block-paired with. Without this clause a block silences him for her while leaving him free to keep writing into a thread she can no longer see.';

-- messages_update_own is what the read-receipt RPC in 085 exists to work
-- around, so it carries almost no traffic. Included anyway: it is the third
-- policy on this table with no TO clause, and leaving one behind is how the
-- audience rule stops being a rule. Explicit WITH CHECK for the 080:178 reason.
DROP POLICY IF EXISTS "messages_update_own" ON public.messages;

CREATE POLICY "messages_update_own" ON public.messages
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = sender_id
    AND NOT public.blocked_in_conversation(conversation_id)      -- new in 088
  )
  WITH CHECK (
    auth.uid() = sender_id
    AND NOT public.blocked_in_conversation(conversation_id)      -- new in 088
  );

COMMENT ON POLICY "messages_update_own" ON public.messages IS
  'A sender may still edit her own message unless the thread now holds a block. Not the read-receipt path -- that is mark_conversation_read() (085), which is SECURITY DEFINER and unaffected by this policy.';


-- ── 10. What the client must now do ─────────────────────────────────────────
--
-- The database stops serving the rows the moment block_user() commits, but the
-- app is holding a page of posts it already fetched. store/safetyStore.ts
-- (blockUser) now prunes feedStore and connectStore in place and bumps
-- blockVersion; any surface that keeps its own copy of rows -- ReelsFeed's
-- local `reels` state is the one that does -- must subscribe to blockVersion
-- and refetch. Without that the woman sees the post she just blocked until she
-- swipes past it.
COMMENT ON FUNCTION public.block_user(uuid) IS
  'Blocks a member: drops any reverse friendship row and records status=''blocked'' from the caller. Entry point for the mechanism 008_safety.sql described but never built (085). Enforcement lives in blocked_pair() and the policies that call it (088) -- before 088 this function wrote a row nothing read.';

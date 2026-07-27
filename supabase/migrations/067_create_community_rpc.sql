-- ============================================================
-- 067_create_community_rpc.sql
-- Feature gap: communities_insert_auth (003_communities_social.sql) already
-- lets any authenticated user INSERT a community, but no UI anywhere (mobile
-- or Studio) ever called it -- hosts had no self-serve way to start a
-- community at all. Adding the RPC + fixing two RLS gaps found while
-- building it:
--   1. communities_insert_auth doesn't force created_by = auth.uid() --
--      a client could attribute a community to someone else.
--   2. cm_insert_own doesn't restrict `role` -- any user could INSERT
--      themselves into ANY community as 'admin' or 'moderator' directly,
--      a privilege-escalation gap. Every legitimate client call site
--      (communityStore.ts) already always inserts role:'member', so this
--      tightening changes no real behavior.
-- ============================================================

DROP POLICY IF EXISTS "communities_insert_auth" ON public.communities;
CREATE POLICY "communities_insert_auth" ON public.communities
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL AND created_by = auth.uid());

DROP POLICY IF EXISTS "cm_insert_own" ON public.community_members;
CREATE POLICY "cm_insert_own" ON public.community_members
  FOR INSERT WITH CHECK (auth.uid() = user_id AND role = 'member');

CREATE OR REPLACE FUNCTION public.create_community(
  p_name text,
  p_slug text,
  p_description text,
  p_category text,
  p_is_private boolean DEFAULT false
)
RETURNS public.communities
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_community public.communities;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Must be signed in';
  END IF;

  INSERT INTO public.communities (name, slug, description, category, is_private, created_by)
  VALUES (p_name, p_slug, p_description, p_category, p_is_private, auth.uid())
  RETURNING * INTO v_community;

  -- Creator becomes admin atomically -- this INSERT runs as SECURITY DEFINER
  -- so it bypasses cm_insert_own's role='member' restriction above.
  INSERT INTO public.community_members (community_id, user_id, role)
  VALUES (v_community.id, auth.uid(), 'admin');

  RETURN v_community;
END;
$$;

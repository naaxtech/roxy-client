-- supabase/migrations/015_fix_community_rls.sql
--
-- Problem 1: cm_read_community_member policy queries community_members from
--   within a policy ON community_members → PostgreSQL detects infinite recursion.
--
-- Problem 2: communities_read_public only exposes is_private=false rows, so
--   members of private communities cannot read the community they joined.
--
-- Fix: SECURITY DEFINER function runs without RLS, breaking the recursive cycle.
--   Policies that need to check membership call this function safely.

-- ── 1. Safe membership check (no RLS, no recursion) ────────────────────────
CREATE OR REPLACE FUNCTION public.is_community_member(cid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.community_members
    WHERE community_id = cid
      AND user_id = auth.uid()
  );
$$;

-- ── 2. Fix community_members SELECT policy ──────────────────────────────────
-- Drop the recursive policy and replace it with one using the safe function.
DROP POLICY IF EXISTS "cm_read_community_member" ON public.community_members;

CREATE POLICY "cm_read_community_member" ON public.community_members
  FOR SELECT USING (is_community_member(community_id));

-- ── 3. Allow members to read private communities they belong to ─────────────
-- communities_read_public already covers is_private=false rows.
-- This policy adds coverage for private communities where the user is a member.
DROP POLICY IF EXISTS "communities_read_member" ON public.communities;

CREATE POLICY "communities_read_member" ON public.communities
  FOR SELECT USING (is_community_member(id));

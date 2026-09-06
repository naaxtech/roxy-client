-- 115 — Who used an invite code, and what kind of account they are
--
-- The Studio codes list only showed "1 of 1 used". Pending applicants are
-- is_active = false, so profiles_select_public hides them from a host who
-- is not staff. This RPC is the same visibility as reading the code itself
-- (staff, or admin/border_patrol of that community) and returns the woman
-- the code actually admitted.

create or replace function public.invite_code_redeemers()
returns table (
  code_id uuid,
  user_id uuid,
  display_name text,
  username text,
  vetting_status text,
  access_tier text,
  staff_role text,
  is_staff boolean,
  is_community_owner boolean,
  used_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    c.id,
    p.id,
    coalesce(nullif(btrim(p.display_name), ''), 'Applicant'),
    p.username,
    p.vetting_status,
    p.access_tier::text,
    p.staff_role,
    coalesce(p.is_staff, false),
    coalesce(p.is_community_owner, false),
    coalesce(a.submitted_at, p.created_at)
  from public.invite_codes c
  join public.profiles p on p.admitted_via_code_id = c.id
  left join public.membership_applications a
    on a.auth_user_id = p.id
   and a.code_id = c.id
  where
    public.is_roxy_staff()
    or exists (
      select 1
      from public.community_members m
      where m.community_id = c.community_id
        and m.user_id = auth.uid()
        and m.role in ('admin', 'border_patrol')
    );
$$;

revoke all on function public.invite_code_redeemers() from public, anon;
grant execute on function public.invite_code_redeemers() to authenticated;

comment on function public.invite_code_redeemers() is
  'Hosts and staff: who each visible invite code admitted, and what that account is.';

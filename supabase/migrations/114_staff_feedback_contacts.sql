-- 114 — Staff can see who filed app feedback, and email them
--
-- app_feedback.user_id is the reporter. Display name lives on profiles.
-- The inbox address lives on auth.users, which clients cannot read. This
-- RPC is the staff-only door to that address so Studio can open a reply.

create or replace function public.staff_feedback_contacts(p_user_ids uuid[])
returns table(user_id uuid, email text)
language sql
security definer
stable
set search_path = public, auth
as $$
  select u.id, u.email::text
  from auth.users u
  where public.is_roxy_staff()
    and p_user_ids is not null
    and u.id = any (p_user_ids);
$$;

revoke all on function public.staff_feedback_contacts(uuid[]) from public, anon;
grant execute on function public.staff_feedback_contacts(uuid[]) to authenticated;

comment on function public.staff_feedback_contacts(uuid[]) is
  'Staff/core only. Returns auth emails for the given profile ids so a feedback report can be answered.';

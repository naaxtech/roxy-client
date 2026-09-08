-- Undoes 112_core_owns_host_tools.sql.

drop policy if exists communities_read_core on public.communities;
drop policy if exists cm_read_core on public.community_members;
drop policy if exists events_select_core on public.events;
drop policy if exists community_rooms_select_core on public.community_rooms;
drop policy if exists community_games_select_core on public.community_games;
drop policy if exists communities_update_core on public.communities;
drop policy if exists events_update_core on public.events;
drop policy if exists community_rooms_insert_core on public.community_rooms;
drop policy if exists community_rooms_update_core on public.community_rooms;
drop policy if exists community_games_insert_core on public.community_games;
drop policy if exists community_games_delete_core on public.community_games;

drop policy if exists ic_insert_admin on public.invite_codes;
create policy ic_insert_admin on public.invite_codes
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and is_review_code = false
    and exists (
      select 1 from public.community_members m
      where m.community_id = invite_codes.community_id
        and m.user_id = auth.uid()
        and m.role in ('admin', 'border_patrol')
    )
  );

drop policy if exists ic_update_admin on public.invite_codes;
create policy ic_update_admin on public.invite_codes
  for update to authenticated
  using (
    is_review_code = false
    and exists (
      select 1 from public.community_members m
      where m.community_id = invite_codes.community_id
        and m.user_id = auth.uid()
        and m.role in ('admin', 'border_patrol')
    )
  )
  with check (
    is_review_code = false
    and exists (
      select 1 from public.community_members m
      where m.community_id = invite_codes.community_id
        and m.user_id = auth.uid()
        and m.role in ('admin', 'border_patrol')
    )
  );

create or replace function public.can_review_application(app_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.membership_applications a
    cross join lateral (
      select p.is_staff, p.vetting_status from public.profiles p where p.id = auth.uid()
    ) me
    left join public.reviewer_settings rs on rs.user_id = auth.uid()
    where a.id = app_id
      and me.vetting_status = 'approved'
      and rs.reviewer_agreement_at is not null
      and (
        me.is_staff
        or exists (
          select 1 from public.community_members m
          where m.community_id = a.community_id
            and m.user_id = auth.uid()
            and m.role in ('admin', 'border_patrol')
        )
        or (
          rs.accepts_overflow
          and a.status = 'pending'
          and a.submitted_at <
              now() - make_interval(days => (select overflow_after_days from public.gate_settings))
          and exists (
            select 1 from public.community_members m2
            where m2.user_id = auth.uid()
              and m2.role in ('admin', 'border_patrol')
          )
        )
      )
  );
$$;

comment on function public.can_review_application(uuid) is
  'Reviewer capability: vetted + agreement signed, then staff OR own-community admin/border_patrol OR opted-in overflow on an aged application.';

comment on function public.is_roxy_core() is
  'True only for seeded Roxy HQ accounts. Used by set_staff_role.';

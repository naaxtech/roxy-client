-- 112 — Roxy core owns every host tool
--
-- Studio was listing communities from community_members. Core HQ is not an
-- admin of those communities — they own Roxy. This file is the database half
-- of that: core can see private communities, every roster, every event, every
-- room and game, mint and revoke invite codes, and review applications
-- without first being vetted as a member or signing the reviewer agreement.
-- Staff (non-core) stays scoped to the communities they actually run.

comment on function public.is_roxy_core() is
  'True only for Roxy HQ. Host tools, private communities, rooms, games, invites, and application review all treat core as owner.';

-- ── See everything ──────────────────────────────────────────────────────────
drop policy if exists communities_read_core on public.communities;
create policy communities_read_core on public.communities
  for select to authenticated
  using (public.is_roxy_core());

drop policy if exists cm_read_core on public.community_members;
create policy cm_read_core on public.community_members
  for select to authenticated
  using (public.is_roxy_core());

drop policy if exists events_select_core on public.events;
create policy events_select_core on public.events
  for select to authenticated
  using (public.is_roxy_core());

drop policy if exists community_rooms_select_core on public.community_rooms;
create policy community_rooms_select_core on public.community_rooms
  for select to authenticated
  using (public.is_roxy_core());

drop policy if exists community_games_select_core on public.community_games;
create policy community_games_select_core on public.community_games
  for select to authenticated
  using (public.is_roxy_core());

-- ── Edit everything ─────────────────────────────────────────────────────────
drop policy if exists communities_update_core on public.communities;
create policy communities_update_core on public.communities
  for update to authenticated
  using (public.is_roxy_core())
  with check (public.is_roxy_core());

drop policy if exists events_update_core on public.events;
create policy events_update_core on public.events
  for update to authenticated
  using (public.is_roxy_core())
  with check (public.is_roxy_core());

drop policy if exists community_rooms_insert_core on public.community_rooms;
create policy community_rooms_insert_core on public.community_rooms
  for insert to authenticated
  with check (public.is_roxy_core() and created_by = auth.uid());

drop policy if exists community_rooms_update_core on public.community_rooms;
create policy community_rooms_update_core on public.community_rooms
  for update to authenticated
  using (public.is_roxy_core())
  with check (public.is_roxy_core());

drop policy if exists community_games_insert_core on public.community_games;
create policy community_games_insert_core on public.community_games
  for insert to authenticated
  with check (public.is_roxy_core());

drop policy if exists community_games_delete_core on public.community_games;
create policy community_games_delete_core on public.community_games
  for delete to authenticated
  using (public.is_roxy_core());

-- Invite codes: staff can already SELECT (ic_read_staff). Minting and
-- revoking still required a community admin membership. Core does not have
-- one, and should not need one.
drop policy if exists ic_insert_admin on public.invite_codes;
create policy ic_insert_admin on public.invite_codes
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and is_review_code = false
    and (
      public.is_roxy_core()
      or exists (
        select 1 from public.community_members m
        where m.community_id = invite_codes.community_id
          and m.user_id = auth.uid()
          and m.role in ('admin', 'border_patrol')
      )
    )
  );

drop policy if exists ic_update_admin on public.invite_codes;
create policy ic_update_admin on public.invite_codes
  for update to authenticated
  using (
    is_review_code = false
    and (
      public.is_roxy_core()
      or exists (
        select 1 from public.community_members m
        where m.community_id = invite_codes.community_id
          and m.user_id = auth.uid()
          and m.role in ('admin', 'border_patrol')
      )
    )
  )
  with check (
    is_review_code = false
    and (
      public.is_roxy_core()
      or exists (
        select 1 from public.community_members m
        where m.community_id = invite_codes.community_id
          and m.user_id = auth.uid()
          and m.role in ('admin', 'border_patrol')
      )
    )
  );

-- Core owns review. They do not sit behind member vetting or the reviewer
-- agreement — those gates are for community hosts, not HQ.
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
      select p.is_staff, p.vetting_status, p.staff_role
      from public.profiles p
      where p.id = auth.uid()
    ) me
    left join public.reviewer_settings rs on rs.user_id = auth.uid()
    where a.id = app_id
      and (
        me.staff_role = 'core'
        or (
          me.vetting_status = 'approved'
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
        )
      )
  );
$$;

comment on function public.can_review_application(uuid) is
  'Reviewer capability: Roxy core, or vetted + agreement then staff / own-community admin-or-patrol / opted-in overflow.';

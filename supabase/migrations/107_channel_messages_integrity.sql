-- 107 — Two holes in the channel message table, found by review of 105
--
-- Both were verified by running the attack against production:
--
--   1. THE PERSON BEING MODERATED COULD UNDO THE MODERATION.
--      105 granted `update (body, edited_at, deleted_at)` to authenticated and
--      wrote "authors edit their own message" as USING (sender_id = auth.uid()).
--      Nothing said the author may not write `deleted_at`. So:
--          update community_channel_messages set deleted_at = null where id = <hers>
--      brought a moderator-removed message straight back, unlimited times. The
--      only removal mechanism the schema has was reversible by its subject.
--
--   2. A MODERATOR COULD REWRITE ANOTHER WOMAN'S WORDS.
--      "moderators moderate channel messages" is FOR UPDATE with no column
--      predicate, and `body` is in the role-wide grant — Postgres cannot scope
--      a column grant per policy. A moderator ran
--          update ... set body = 'I never said that' where id = <Maya's>
--      and it succeeded, silently: nothing sets edited_at, so the row did not
--      even render as edited. In a WLW app where a screenshot is evidence, that
--      is putting words in a member's mouth with no trace.
--
-- 105's verification run covered "editing her OWN body ALLOWED" and "hard
-- DELETE REFUSED". It never tested a member WRITING deleted_at, nor a moderator
-- writing body. Both were one column away from what was checked.
--
-- RLS cannot express either rule: a policy chooses rows, and WITH CHECK sees
-- only NEW, so it cannot say "this column may not change". A trigger comparing
-- OLD to NEW is the only place the rule fits.

create or replace function public.community_channel_messages_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_author boolean := old.sender_id is not null and old.sender_id = auth.uid();
  is_mod boolean;
begin
  select public.is_community_moderator(c.community_id)
    into is_mod
    from public.community_channels c
   where c.id = old.channel_id;

  -- Words belong to whoever said them. A moderator removes a message; she never
  -- rewrites one. This is the rule that makes a screenshot mean something.
  if new.body is distinct from old.body and not is_author then
    raise exception 'Only the author can change a message''s text'
      using errcode = '42501';
  end if;

  -- Restoring a removed message is a moderator's call to reverse, never the
  -- call of the woman who was moderated. Gated on OLD.deleted_at: reading only
  -- NEW would let the caller pick which rule applies to her.
  if old.deleted_at is not null and new.deleted_at is null and not is_mod then
    raise exception 'Only a moderator can restore a removed message'
      using errcode = '42501';
  end if;

  -- Removing one is either woman's to do: her own, or a moderator's decision.
  if old.deleted_at is null and new.deleted_at is not null
     and not (is_author or is_mod) then
    raise exception 'You cannot remove this message'
      using errcode = '42501';
  end if;

  -- `edited_at` was a read with no writer: ChannelMessage renders an "edited"
  -- badge from it and nothing in the codebase ever set it. The trigger owns it
  -- now, so the badge tells the truth and the client cannot forge it — which is
  -- also why the grant on the column is revoked below.
  if new.body is distinct from old.body then
    new.edited_at := now();
  else
    new.edited_at := old.edited_at;
  end if;

  -- Neither of these is anyone's to move after the fact.
  new.created_at := old.created_at;
  new.sender_id := old.sender_id;
  new.channel_id := old.channel_id;

  return new;
end;
$$;

drop trigger if exists community_channel_messages_guard on public.community_channel_messages;
create trigger community_channel_messages_guard
  before update on public.community_channel_messages
  for each row
  execute function public.community_channel_messages_guard();

-- The trigger writes edited_at; nobody else needs to.
revoke update (edited_at) on public.community_channel_messages from authenticated;

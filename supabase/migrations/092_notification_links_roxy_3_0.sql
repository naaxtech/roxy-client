-- 092 — repoint notification deep links at the Roxy 3.0 routes
--
-- Migration 057 hardcoded '/(tabs)/grow/people' into two trigger functions, and
-- the 3.0 redesign dissolves the Grow tab: friend requests now live in the
-- request-first inbox on Messages.
--
-- Two things have to change, and only fixing one of them is the trap:
--
--   1. the trigger functions, so new notifications get the new path, and
--   2. the rows ALREADY in the table, which carry the old path and would open a
--      dead route the moment a woman taps one. A code-only fix leaves every
--      existing notification broken.
--
-- Reversible: 057's original definitions are restored by the matching down
-- migration, including the row back-fill.
--
-- src: docs/handoff/roxy-3.0/PROMPT.md · request-first inbox · 2026-08-17

-- ── 1. New notifications point at the inbox ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_friend_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sender_name text;
BEGIN
  IF NEW.status = 'pending' THEN
    -- Dedup: an unread request notification from this sender already exists
    -- (cancel-and-resend must not spam the recipient).
    IF NOT EXISTS (
      SELECT 1 FROM notifications
      WHERE user_id = NEW.addressee_id AND actor_id = NEW.requester_id
        AND type = 'friend_request' AND read_at IS NULL
    ) THEN
      SELECT display_name INTO sender_name FROM profiles WHERE id = NEW.requester_id;
      INSERT INTO notifications (user_id, actor_id, type, title, body, link_path)
      VALUES (
        NEW.addressee_id,
        NEW.requester_id,
        'friend_request',
        left(COALESCE(sender_name, 'Someone'), 150) || ' sent you a friend request',
        'Accept to start chatting 💜',
        '/(tabs)/messages'
      );
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.notify_friend_accept()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE accepter_name text;
BEGIN
  IF NEW.status = 'accepted' AND OLD.status = 'pending' THEN
    SELECT display_name INTO accepter_name FROM profiles WHERE id = NEW.addressee_id;
    INSERT INTO notifications (user_id, actor_id, type, title, body, link_path)
    VALUES (
      NEW.requester_id,
      NEW.addressee_id,
      'friend_accept',
      left(COALESCE(accepter_name, 'Someone'), 150) || ' accepted your friend request',
      'You are now connected 🌸',
      '/(tabs)/messages'
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END $$;

-- ── 2. Rows already written by the old functions ────────────────────────────
-- Without this, every notification a member is holding today opens a route that
-- no longer exists.
UPDATE public.notifications
SET link_path = '/(tabs)/messages'
WHERE link_path = '/(tabs)/grow/people';

-- The community-event trigger (057 line 121) already writes '/event/<id>', a
-- root route the redesign does not move. It is deliberately untouched.

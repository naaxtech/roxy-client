-- 140 down — reverses 140_supporter_entitlements.sql.
-- Run only inside a transaction you have backed up. This drops every member's
-- subscription and entitlement rows AND the RevenueCat event log: export
-- supporter_events first if anyone has paid (it is the record support and
-- refunds work from). RevenueCat keeps the subscriptions; re-applying 140 and
-- replaying events from the RevenueCat dashboard rebuilds the rows.
-- Rollback order on production: flip platform_settings.supporter_enabled off
-- first (perks stop at once), then this file — and any S2 migration that calls
-- is_supporter() must be reversed before it.
-- destructive-ok: down file

DROP FUNCTION IF EXISTS public.apply_supporter_event(
  text, text, text, uuid, timestamptz, text, timestamptz, text, text, text, uuid[], jsonb
);
DROP FUNCTION IF EXISTS public.supporter_enabled();
DROP FUNCTION IF EXISTS public.is_supporter(uuid);
DROP FUNCTION IF EXISTS public._supporter_refresh(uuid);
DROP TABLE IF EXISTS public.supporter_events;
DROP TABLE IF EXISTS public.supporter_entitlements;
DROP TABLE IF EXISTS public.supporter_subscriptions;
ALTER TABLE public.platform_settings
  DROP COLUMN IF EXISTS supporter_sandbox_counts,
  DROP COLUMN IF EXISTS supporter_enabled;

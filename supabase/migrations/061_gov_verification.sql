-- 061: government verification flag — staff-set trust signal shown as a
-- shield badge on the profile header. No client write path: set later by
-- staff tooling via the service-role client. Existing profiles select
-- policies already cover read access, so no RLS changes are needed here.
-- Retry-safe: re-pushing this migration after a partial run is a no-op.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS gov_verified boolean NOT NULL DEFAULT false;

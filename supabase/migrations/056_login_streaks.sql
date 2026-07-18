-- 056: login streaks — consecutive-day check-ins, computed server-side.
-- Client calls record_daily_checkin() once per app open; server date logic
-- (UTC) prevents client-clock manipulation. Streak cadence is emotional-AI
-- training-relevant data (flat typed columns per data-pipeline rules).

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS streak_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS streak_last_day date;

CREATE OR REPLACE FUNCTION record_daily_checkin()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  today date := (now() AT TIME ZONE 'utc')::date;
  last_day date;
  new_count int;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT streak_last_day, streak_count INTO last_day, new_count
  FROM profiles WHERE id = uid FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found';
  END IF;

  IF last_day = today THEN
    RETURN new_count;              -- already checked in today
  ELSIF last_day = today - 1 THEN
    new_count := new_count + 1;    -- consecutive day
  ELSE
    new_count := 1;                -- first day, or streak broken
  END IF;

  UPDATE profiles
  SET streak_count = new_count, streak_last_day = today
  WHERE id = uid;

  RETURN new_count;
END;
$$;

REVOKE ALL ON FUNCTION record_daily_checkin() FROM public;
GRANT EXECUTE ON FUNCTION record_daily_checkin() TO authenticated;

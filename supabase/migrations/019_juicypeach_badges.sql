-- 019_juicypeach_badges.sql
-- Seed 3 earned badges for @juicypeach (dev/demo data)

DO $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM profiles WHERE username = 'juicypeach' LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'User @juicypeach not found — skipping badge seed';
    RETURN;
  END IF;

  INSERT INTO user_badge_progress (user_id, badge_id, current_value, earned_at)
  SELECT
    v_user_id,
    b.id,
    b.requirement_threshold,
    now()
  FROM badges b
  WHERE b.name IN ('Speed Dater', 'Community Builder', 'Conversation Starter')
  ON CONFLICT (user_id, badge_id) DO UPDATE
    SET current_value = EXCLUDED.current_value,
        earned_at     = COALESCE(user_badge_progress.earned_at, EXCLUDED.earned_at);

  RAISE NOTICE 'Seeded 3 badges for @juicypeach (user_id: %)', v_user_id;
END;
$$;

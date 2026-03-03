-- DEV SEED — run on dev Supabase project only
-- Pauses all AI calls in development by default (saves money during testing)
INSERT INTO dev_config (key, value)
VALUES ('ai_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

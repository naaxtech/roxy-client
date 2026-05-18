-- Auto-join every profile to all public communities so dev users see seeded feed content
-- without manually joining each community. Safe to re-run (ON CONFLICT DO NOTHING).

INSERT INTO public.community_members (community_id, user_id, role)
SELECT c.id, p.id, 'member'
FROM   public.communities c
CROSS  JOIN public.profiles p
WHERE  c.is_private = false
ON CONFLICT (community_id, user_id) DO NOTHING;

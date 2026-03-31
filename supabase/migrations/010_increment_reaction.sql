-- Atomically increment a reaction count on a post
CREATE OR REPLACE FUNCTION public.increment_reaction(p_post_id uuid, p_emoji text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.posts
  SET reaction_counts = jsonb_set(
    COALESCE(reaction_counts, '{}'::jsonb),
    ARRAY[p_emoji],
    to_jsonb(COALESCE((reaction_counts->>p_emoji)::int, 0) + 1)
  )
  WHERE id = p_post_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_reaction(uuid, text) TO authenticated;

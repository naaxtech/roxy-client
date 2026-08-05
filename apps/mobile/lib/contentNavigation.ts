import type { Post, PostType } from '../types';
import { supabase } from './supabase';
import { GAME_ROUTES } from './games';

/**
 * Community-owned content lives under /community/* so Connect/Discover feeds
 * open detail without switching tabs (feeds are filtered views of community posts).
 */
export function contentDetailPath(postId: string, postType: PostType): string {
  if (postType === 'video') {
    return `/community/video/${postId}`;
  }
  return `/community/post/${postId}`;
}

/**
 * Where a roxy_link post's CTA (Join Game / Join Room / View Event) should
 * actually take the user. Games need a slug lookup; rooms join the live
 * session; events open detail. Returns null when the link can't resolve.
 */
export async function linkedEntityPath(post: Post): Promise<string | null> {
  const entityId = post.link_entity_id;
  if (!entityId) return null;
  switch (post.link_type) {
    case 'room':
      // Root route, not the Connect stack — the call stage overlays the current
      // tab. Pushing it inside Connect stranded a dead call screen as that
      // stack's top route. Every other caller already uses this path.
      return `/community-room-session?room_id=${entityId}`;
    case 'event':
      return `/event/${entityId}`;
    case 'game': {
      const { data } = await supabase
        .from('games')
        .select('slug, url, name')
        .eq('id', entityId)
        .maybeSingle();
      if (!data) return null;
      if (data.slug && GAME_ROUTES[data.slug]) return GAME_ROUTES[data.slug];
      if (data.url) return data.url;
      if (data.name === 'Speed Dating') return '/speed-dating';
      return null;
    }
    default:
      return null;
  }
}

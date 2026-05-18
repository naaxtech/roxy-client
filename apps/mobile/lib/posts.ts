import { supabase } from './supabase';
import { logError } from './errorLogger';
import { POST_WITH_AUTHOR } from './supabaseQueries';
import type { Post, PostType } from '../types';

const POST_TYPES: PostType[] = [
  'standard', 'event', 'poll', 'resource',
  'photo', 'gallery', 'video', 'roxy_link',
];

function parseMediaUrls(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.filter((u): u is string => typeof u === 'string');
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((u): u is string => typeof u === 'string');
    } catch {
      return raw.length > 0 ? [raw] : [];
    }
  }
  return [];
}

/** Normalize a Supabase posts row for feed components (spec: 2026-04-24-content-feed-design). */
export function normalizePost(row: Record<string, unknown>): Post {
  const postType = POST_TYPES.includes(row.post_type as PostType)
    ? (row.post_type as PostType)
    : 'standard';

  return {
    id: String(row.id),
    author_id: String(row.author_id),
    community_id: String(row.community_id),
    content: String(row.content ?? ''),
    media_urls: parseMediaUrls(row.media_urls),
    post_type: postType,
    is_pinned: Boolean(row.is_pinned),
    is_flagged: Boolean(row.is_flagged),
    reaction_counts: (row.reaction_counts as Record<string, number>) ?? {},
    comment_count: Number(row.comment_count ?? 0),
    like_count: Number(row.like_count ?? 0),
    save_count: Number(row.save_count ?? 0),
    feed_score: Number(row.feed_score ?? 0),
    blurhash: (row.blurhash as string | null) ?? null,
    deleted_at: (row.deleted_at as string | null) ?? null,
    video_url: (row.video_url as string | null) ?? null,
    video_thumbnail_url: (row.video_thumbnail_url as string | null) ?? null,
    video_duration_secs: row.video_duration_secs != null ? Number(row.video_duration_secs) : null,
    video_aspect_ratio: (row.video_aspect_ratio as Post['video_aspect_ratio']) ?? null,
    link_type: (row.link_type as Post['link_type']) ?? null,
    link_entity_id: (row.link_entity_id as string | null) ?? null,
    link_community_id: (row.link_community_id as string | null) ?? null,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
    profiles: row.profiles as Post['profiles'],
  };
}

export function normalizePosts(rows: unknown[] | null | undefined): Post[] {
  return (rows ?? []).map((row) => normalizePost(row as Record<string, unknown>));
}

export async function fetchPostById(postId: string): Promise<Post | null> {
  const { data, error } = await supabase
    .from('posts')
    .select(POST_WITH_AUTHOR)
    .eq('id', postId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) {
    logError(error, 'fetchPostById');
    return null;
  }
  if (!data) return null;
  return normalizePost(data as Record<string, unknown>);
}

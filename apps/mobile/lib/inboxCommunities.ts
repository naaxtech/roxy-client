import { supabase } from './supabase';
import type { Community } from '../store/communityStore';

/**
 * What the Messages inbox needs from a joined community so DIRECT and
 * COMMUNITY CHATS can sit as two lists (prototype markup 421–448).
 *
 * The store only has membership. Channel count and the last line live on
 * other tables; this module fills those in, and falls back to a member-count
 * line when the extra read fails so the section never goes blank.
 */
export type InboxCommunity = {
  id: string;
  name: string;
  member_count: number;
  channelCount: number;
  preview: string;
  unreadCount: number;
  muted: boolean;
};

export type InboxCommunityMeta = {
  channelCount: number;
  preview: string;
  unreadCount?: number;
  muted?: boolean;
};

export function channelCountLabel(count: number): string {
  return count > 0 ? `${count} CHANNELS` : 'CHANNELS';
}

export function communityPreviewLine(opts: {
  slug?: string | null;
  author?: string | null;
  body?: string | null;
  memberCount?: number;
}): string {
  const slug = opts.slug?.trim();
  const body = opts.body?.trim();
  if (slug && body) {
    const who = opts.author?.trim();
    return who ? `#${slug} · ${who}: ${body}` : `#${slug} · ${body}`;
  }
  if (typeof opts.memberCount === 'number') {
    return `${opts.memberCount} members · open channels`;
  }
  return 'Open channels';
}

export function inboxCommunityFromJoined(
  community: Pick<Community, 'id' | 'name' | 'member_count'>,
  meta?: InboxCommunityMeta,
): InboxCommunity {
  return {
    id: community.id,
    name: community.name,
    member_count: community.member_count,
    channelCount: meta?.channelCount ?? 0,
    preview: meta?.preview || communityPreviewLine({ memberCount: community.member_count }),
    unreadCount: meta?.unreadCount ?? 0,
    muted: meta?.muted ?? false,
  };
}

export function filterInboxByQuery<T>(
  items: T[],
  query: string,
  textOf: (item: T) => string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => textOf(item).toLowerCase().includes(q));
}

type ChannelRow = {
  id: string;
  community_id: string;
  slug: string;
  is_default: boolean;
  position: number;
};

type MessageRow = {
  body: string;
  created_at: string;
  channel_id: string;
  author: { display_name?: string | null; username?: string | null } | { display_name?: string | null; username?: string | null }[] | null;
};

function previewAuthor(author: MessageRow['author']): string | null {
  const row = !author ? null : Array.isArray(author) ? (author[0] ?? null) : author;
  if (!row) return null;
  return row.display_name?.trim() || row.username?.trim() || null;
}

/**
 * One extra read for the inbox community rows: how many channels, and the
 * newest line across them. Failures return {} so the list still paints.
 */
export async function fetchInboxCommunityMeta(
  communityIds: string[],
): Promise<Record<string, InboxCommunityMeta>> {
  if (communityIds.length === 0) return {};

  const { data: channels, error: channelError } = await supabase
    .from('community_channels')
    .select('id, community_id, slug, is_default, position')
    .in('community_id', communityIds);

  if (channelError || !channels) return {};

  const rows = channels as ChannelRow[];
  const counts: Record<string, number> = {};
  const defaultSlug: Record<string, string> = {};
  const channelToCommunity = new Map<string, string>();
  const channelSlug = new Map<string, string>();

  for (const row of rows) {
    counts[row.community_id] = (counts[row.community_id] ?? 0) + 1;
    channelToCommunity.set(row.id, row.community_id);
    channelSlug.set(row.id, row.slug);
    if (row.is_default || !defaultSlug[row.community_id]) {
      defaultSlug[row.community_id] = row.slug;
    }
  }

  const channelIds = rows.map((r) => r.id);
  const latest: Record<string, { slug: string; author: string | null; body: string }> = {};

  if (channelIds.length > 0) {
    const { data: messages } = await supabase
      .from('community_channel_messages')
      .select(
        'body, created_at, channel_id, author:profiles!community_channel_messages_sender_id_fkey(display_name, username)',
      )
      .in('channel_id', channelIds)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(Math.max(communityIds.length * 4, 24));

    for (const msg of (messages ?? []) as MessageRow[]) {
      const communityId = channelToCommunity.get(msg.channel_id);
      if (!communityId || latest[communityId]) continue;
      latest[communityId] = {
        slug: channelSlug.get(msg.channel_id) ?? defaultSlug[communityId] ?? 'general',
        author: previewAuthor(msg.author),
        body: msg.body,
      };
    }
  }

  const meta: Record<string, InboxCommunityMeta> = {};
  for (const id of communityIds) {
    const last = latest[id];
    meta[id] = {
      channelCount: counts[id] ?? 0,
      // Empty preview lets the caller keep the member-count fallback.
      preview: last
        ? communityPreviewLine({ slug: last.slug, author: last.author, body: last.body })
        : '',
    };
  }
  return meta;
}

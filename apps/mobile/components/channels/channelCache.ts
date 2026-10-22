import type { Channel, ChannelMessage } from '../../lib/channels';
import { isPending } from './pendingMessages';

/**
 * In-session memory for the community channels screen (motion spec F7: a
 * second visit shows content in the first frame, no loader).
 *
 * Memory only, never persisted (decision P2 keeps chat out of any cold-start
 * cache, and nothing private is written to disk). Keyed by the signed-in
 * member; another member signing in wipes it. Bounded: at most
 * CHANNEL_CACHE_MAX communities and CHANNEL_CACHE_MAX channel pages, least
 * recently written dropped first; each page keeps its newest rows only.
 * Provisional (pending) rows are never remembered. The live stage is not
 * remembered either: it is volatile and is always fetched fresh.
 */
export const CHANNEL_CACHE_MAX = 20;
const DEFAULT_PAGE = 50;

export interface CommunitySnapshot {
  channels: Channel[];
  communityName: string;
  communitySlug: string | null;
  isModerator: boolean;
}

let owner: string | null = null;
const communities = new Map<string, CommunitySnapshot>();
const pages = new Map<string, ChannelMessage[]>();

function claim(me: string): void {
  if (owner === me) return;
  communities.clear();
  pages.clear();
  owner = me;
}

function putBounded<T>(map: Map<string, T>, key: string, value: T): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > CHANNEL_CACHE_MAX) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

export function readCommunitySnapshot(me: string, communityId: string): CommunitySnapshot | null {
  if (!me || owner !== me) return null;
  return communities.get(communityId) ?? null;
}

export function writeCommunitySnapshot(me: string, communityId: string, snap: CommunitySnapshot): void {
  if (!me || !communityId) return;
  claim(me);
  putBounded(communities, communityId, snap);
}

export function readChannelPage(me: string, channelId: string): ChannelMessage[] | null {
  if (!me || owner !== me) return null;
  return pages.get(channelId) ?? null;
}

export function writeChannelPage(
  me: string,
  channelId: string,
  rows: readonly ChannelMessage[],
  pageSize: number = DEFAULT_PAGE,
): void {
  if (!me || !channelId) return;
  claim(me);
  putBounded(pages, channelId, rows.filter((m) => !isPending(m)).slice(-pageSize));
}

export function clearChannelCache(): void {
  communities.clear();
  pages.clear();
  owner = null;
}

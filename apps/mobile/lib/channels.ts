import { supabase } from './supabase';

/**
 * Community channels — the design's `# general` chip row and its message list
 * (markup 655–697).
 *
 * Channel membership is never asked here. It is a property of the community, so
 * migration 105's RLS asks `is_community_member(community_id)` and this module
 * simply queries; a client-side check would be a second, weaker answer to a
 * question the database already answers.
 */

export interface Channel {
  id: string;
  community_id: string;
  slug: string;
  name: string;
  topic: string | null;
  position: number;
  is_default: boolean;
}

export interface ChannelAuthor {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

export interface ChannelMessage {
  id: string;
  channel_id: string;
  sender_id: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  author: ChannelAuthor | null;
}

const CHANNEL_FIELDS = 'id, community_id, slug, name, topic, position, is_default';
const MESSAGE_FIELDS =
  'id, channel_id, sender_id, body, created_at, edited_at, deleted_at, ' +
  'author:profiles!community_channel_messages_sender_id_fkey(id, username, display_name, avatar_url)';

/** Newest N, then reversed — a channel reads oldest-first but loads newest-first. */
export const MESSAGE_PAGE = 50;

export const MAX_MESSAGE_LENGTH = 2000;

export async function fetchChannels(communityId: string): Promise<Channel[]> {
  const { data, error } = await supabase
    .from('community_channels')
    .select(CHANNEL_FIELDS)
    .eq('community_id', communityId)
    // The same order the index is built on. Sorting by created_at would make
    // the chip row reshuffle the moment a moderator adds a channel.
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []) as Channel[];
}

export async function fetchChannelMessages(channelId: string): Promise<ChannelMessage[]> {
  const { data, error } = await supabase
    .from('community_channel_messages')
    .select(MESSAGE_FIELDS)
    .eq('channel_id', channelId)
    // The newest page, not the oldest: a channel with 4,000 messages must not
    // load from the beginning of time to show today.
    .order('created_at', { ascending: false })
    .limit(MESSAGE_PAGE);

  if (error) throw error;
  const rows = (data ?? []) as unknown as ChannelMessage[];
  return [...rows].reverse();
}

/**
 * Send a message.
 *
 * Returns the inserted row so the caller can reconcile its optimistic entry
 * against what the database actually stored. PostgREST answers 200 for a write
 * that matched zero rows, so "no error" is not evidence anything happened —
 * only a returned row is.
 */
export async function sendChannelMessage(
  channelId: string,
  senderId: string,
  body: string,
): Promise<ChannelMessage> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error('Nothing to send.');
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    // The same bound as the CHECK constraint. Failing here gives her the
    // message; failing at the constraint gives her a 400.
    throw new Error(`Keep it under ${MAX_MESSAGE_LENGTH} characters.`);
  }

  const { data, error } = await supabase
    .from('community_channel_messages')
    .insert({ channel_id: channelId, sender_id: senderId, body: trimmed })
    .select(MESSAGE_FIELDS)
    .single();

  if (error) throw error;
  if (!data) throw new Error('The message did not send.');
  return data as unknown as ChannelMessage;
}

/**
 * Soft-delete. `deleted_at` rather than a DELETE, so removing a message does not
 * punch a hole in a thread other people are replying to — and migration 105
 * grants no DELETE on the table at all.
 */
export async function deleteChannelMessage(messageId: string): Promise<void> {
  const { error, count } = await supabase
    .from('community_channel_messages')
    .update({ deleted_at: new Date().toISOString() }, { count: 'exact' })
    .eq('id', messageId);

  if (error) throw error;
  // Zero rows means RLS refused her. Reporting success there is how a UI ends
  // up announcing a moderation action that never happened.
  if (!count) throw new Error('That message could not be removed.');
}

/** The name to show. Never the email, and never a raw id. */
export function authorName(author: ChannelAuthor | null): string {
  if (!author) return 'Someone who left';
  return author.display_name?.trim() || author.username?.trim() || 'Someone who left';
}

/** The design's chip label carries the sigil; the stored slug does not. */
export function channelLabel(channel: Channel): string {
  return `# ${channel.slug}`;
}

/**
 * Which channel to open on.
 *
 * The default if there is one, else the first. Returning null for an empty list
 * rather than inventing a channel: a community with none is a real state and
 * the screen has to say so.
 */
export function initialChannel(channels: Channel[]): Channel | null {
  if (channels.length === 0) return null;
  return channels.find((c) => c.is_default) ?? channels[0];
}

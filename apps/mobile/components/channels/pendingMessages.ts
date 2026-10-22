import type { ChannelAuthor, ChannelMessage } from '../../lib/channels';

/**
 * Optimistic channel sends (motion spec F10): her message is in the list in
 * the same frame as Send, as a provisional row with a `pending:` id, and is
 * swapped for the server's row when the insert answers. Pure functions, so the
 * screen's state updates stay one-liners and the rules are unit-tested.
 */

export const PENDING_PREFIX = 'pending:';

let seq = 0;

export function isPending(message: Pick<ChannelMessage, 'id'>): boolean {
  return message.id.startsWith(PENDING_PREFIX);
}

/** A provisional row for what she just sent. */
export function pendingMessage(
  channelId: string,
  senderId: string,
  body: string,
  author: ChannelAuthor | null,
  now: Date = new Date(),
): ChannelMessage {
  seq += 1;
  return {
    id: `${PENDING_PREFIX}${now.getTime()}-${seq}`,
    channel_id: channelId,
    sender_id: senderId,
    body,
    created_at: now.toISOString(),
    edited_at: null,
    deleted_at: null,
    author,
  };
}

/**
 * The insert answered: the provisional row becomes the saved one. If the
 * realtime echo already brought the saved row in, the provisional one simply
 * goes (never two copies).
 */
export function settlePending(list: ChannelMessage[], pendingId: string, saved: ChannelMessage): ChannelMessage[] {
  const hasSaved = list.some((m) => m.id === saved.id);
  if (hasSaved) return list.filter((m) => m.id !== pendingId);
  const at = list.findIndex((m) => m.id === pendingId);
  if (at < 0) return [...list, saved];
  const next = [...list];
  next[at] = saved;
  return next;
}

/** The insert was refused: take the provisional row back out. */
export function dropPending(list: ChannelMessage[], pendingId: string): ChannelMessage[] {
  return list.some((m) => m.id === pendingId) ? list.filter((m) => m.id !== pendingId) : list;
}

/**
 * A realtime row arrived. If it is her own message still drawn as pending
 * (same sender, same body), it replaces the oldest such provisional row in
 * place, so the echo never draws the message twice while the insert's own
 * answer is still on its way.
 */
export function absorbEcho(list: ChannelMessage[], incoming: ChannelMessage): ChannelMessage[] {
  if (list.some((m) => m.id === incoming.id)) return list;
  const at = list.findIndex((m) => isPending(m) && m.sender_id === incoming.sender_id && m.body === incoming.body);
  if (at < 0) return list;
  const next = [...list];
  next[at] = incoming;
  return next;
}

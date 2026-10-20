import { supabase } from './supabase';

/**
 * The chat data layer: every conversation write goes through a SECURITY
 * DEFINER RPC from migration 132.
 *
 * Why RPCs and not table writes: a participant used to be able to rewrite
 * `participant_ids` (a DM-permission bypass) or delete the whole thread (an
 * evidence wipe) because the table policy let her UPDATE/DELETE the row
 * (CHAT-03). The table grants are gone; these functions are the only doors,
 * and each one checks who is knocking.
 *
 * Every wrapper THROWS on a refusal, with the words she should read. A refused
 * write that resolves quietly is the "Report submitted 💜 over nothing" bug
 * this app has shipped before — never again on a safety surface.
 */

export type MemberStatus = 'active' | 'request' | 'declined' | 'left' | 'removed';
export type GroupRole = 'owner' | 'admin' | 'member';

export interface InboxMember {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  last_seen_at: string | null;
  status: MemberStatus;
  role: GroupRole;
}

export interface InboxLastMessage {
  id: string;
  sender_id: string | null;
  message_type: string;
  content: string | null;
  deleted: boolean;
  created_at: string;
  is_read: boolean;
}

/** One row of `inbox_summary()` — a direct or group thread she is in. */
export interface InboxThread {
  conversation_id: string;
  conversation_type: 'direct' | 'group';
  title: string | null;
  avatar_emoji: string | null;
  my_status: 'active' | 'request';
  my_role: GroupRole;
  muted_until: string | null;
  hidden_at: string | null;
  last_message_at: string | null;
  created_at: string;
  created_by: string | null;
  last_message: InboxLastMessage | null;
  unread: number;
  member_count: number;
  /** Up to four OTHER members, oldest first. */
  members: InboxMember[];
}

export interface MessagesBadge {
  chats: number;
  message_requests: number;
  friend_requests: number;
  communities: number;
}

export const EMPTY_BADGE: MessagesBadge = {
  chats: 0,
  message_requests: 0,
  friend_requests: 0,
  communities: 0,
};

export interface ChatSettings {
  read_receipts: boolean;
  group_add_permission: 'friends' | 'nobody';
}

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  read_receipts: true,
  group_add_permission: 'friends',
};

/** The longest message the server accepts (CHECK messages_content_len). */
export const MESSAGE_MAX_LENGTH = 4000;
/** A message request carries at most this many messages until she answers. */
export const REQUEST_MESSAGE_CAP = 3;
/** Edit / unsend window, enforced by the messages_guard_update trigger. */
export const EDIT_WINDOW_MS = 15 * 60 * 1000;
/** Group size, creator included (conversations.max_members cap). */
export const GROUP_MAX_MEMBERS = 32;

type PgError = { code?: string | null; message?: string | null } | null | undefined;

const FALLBACK = 'Something went wrong. Please try again.';

/**
 * The server's refusal, in words she can act on.
 *
 * The RPCs and triggers raise with a machine prefix (`rate_limited:`,
 * `request_cap:` …) so the client can map them; anything unrecognised becomes a
 * generic line — a raw Postgres message never reaches the screen.
 */
export function chatErrorMessage(err: unknown): string {
  const e = err as PgError;
  const message = (e?.message ?? '').trim();
  const code = e?.code ?? '';

  if (message.startsWith('rate_limited')) {
    return message.includes('new chats')
      ? "You've started a lot of new chats today. Try again tomorrow."
      : 'Slow down a moment — you can send more in a minute.';
  }
  if (message.startsWith('request_cap')) {
    return `You can send ${REQUEST_MESSAGE_CAP} messages until she accepts your request.`;
  }
  if (message.startsWith('request_text_only')) {
    return 'Photos and GIFs unlock once she accepts your request.';
  }
  if (message.startsWith('request_declined')) {
    return "She's not accepting messages from you right now.";
  }
  if (message.startsWith('media_not_allowed')) {
    return "That image can't be sent here.";
  }
  if (message.startsWith('edit_window')) {
    return 'Messages can be edited or unsent for 15 minutes.';
  }
  if (message.includes('approved members only')) {
    return "Chat opens once you're an approved member.";
  }
  if (message.includes('not available')) {
    return "That account isn't available.";
  }
  if (code === '23514' && message.includes('content_len')) {
    return `Messages can be up to ${MESSAGE_MAX_LENGTH.toLocaleString('en-US')} characters.`;
  }
  // The group RPCs raise sentences written for people (22023 / 42501 / P0002).
  if (['22023', '42501', 'P0002'].includes(code) && message && !message.includes('policy')
      && !message.includes('permission denied') && !message.includes('violates')) {
    const sentence = message.charAt(0).toUpperCase() + message.slice(1);
    return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
  }
  return FALLBACK;
}

/** Throw her words, keep the original for logging. */
function fail(error: unknown): never {
  const err = new Error(chatErrorMessage(error)) as Error & { cause?: unknown; code?: string };
  err.cause = error;
  err.code = (error as PgError)?.code ?? undefined;
  throw err;
}

async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = args === undefined
    ? await supabase.rpc(name)
    : await supabase.rpc(name, args);
  if (error) fail(error);
  return data as T;
}

/**
 * A v4 UUID minted on the phone.
 *
 * The message's primary key is chosen BEFORE the first attempt, so a retry
 * after a lost response re-sends the same row: the second insert hits the
 * primary key instead of posting the message twice (CHAT-06). Not a secret —
 * RLS decides who may write, not the id — so Math.random is enough where the
 * runtime has no crypto.getRandomValues (Hermes without a polyfill).
 */
export function newMessageId(): string {
  const bytes = new Uint8Array(16);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ── Threads ────────────────────────────────────────────────────────────────

/** Find or open her 1:1 thread. A stranger's lands in the other woman's Requests. */
export function startDirect(userId: string): Promise<string> {
  return rpc<string>('start_direct', { p_user: userId });
}

/** Accept (→ active) or decline (→ hidden; the sender is never told). */
export function respondMessageRequest(conversationId: string, accept: boolean): Promise<string> {
  return rpc<string>('respond_message_request', { p_conv: conversationId, p_accept: accept });
}

export function createGroup(title: string | null, memberIds: string[], emoji: string | null): Promise<string> {
  const name = title?.trim() ? title.trim() : null;
  return rpc<string>('create_group', { p_title: name, p_member_ids: memberIds, p_emoji: emoji || null });
}

export function addGroupMembers(conversationId: string, userIds: string[]): Promise<number> {
  return rpc<number>('add_group_members', { p_conv: conversationId, p_ids: userIds });
}

export function removeGroupMember(conversationId: string, userId: string): Promise<void> {
  return rpc<void>('remove_group_member', { p_conv: conversationId, p_user: userId });
}

export function leaveGroup(conversationId: string): Promise<void> {
  return rpc<void>('leave_group', { p_conv: conversationId });
}

export function renameGroup(conversationId: string, title: string | null, emoji: string | null): Promise<void> {
  return rpc<void>('rename_group', { p_conv: conversationId, p_title: title, p_emoji: emoji });
}

export function setGroupRole(conversationId: string, userId: string, role: 'admin' | 'member'): Promise<void> {
  return rpc<void>('set_group_role', { p_conv: conversationId, p_user: userId, p_role: role });
}

/** `until` null = unmute. A far-future date = "until I turn it back on". */
export function muteConversation(conversationId: string, until: string | null): Promise<void> {
  return rpc<void>('mute_conversation', { p_conv: conversationId, p_until: until });
}

/** "Delete chat" — for her only; the thread comes back if someone writes again. */
export function hideConversation(conversationId: string): Promise<void> {
  return rpc<void>('hide_conversation', { p_conv: conversationId });
}

/** Moves her read cursor; sends a read receipt only if she has them on. */
export function markConversationRead(conversationId: string): Promise<number> {
  return rpc<number>('mark_conversation_read', { p_conversation_id: conversationId });
}

export async function fetchInbox(): Promise<InboxThread[]> {
  const rows = await rpc<InboxThread[] | null>('inbox_summary');
  return rows ?? [];
}

export async function fetchMessagesBadge(): Promise<MessagesBadge> {
  const raw = await rpc<Partial<MessagesBadge> | null>('messages_badge');
  return { ...EMPTY_BADGE, ...(raw ?? {}) };
}

/** The Messages tab badge: unread chats + message requests + friend requests + community unread. */
export function badgeTotal(b: MessagesBadge): number {
  return b.chats + b.message_requests + b.friend_requests + b.communities;
}

export function isMessageRequest(t: Pick<InboxThread, 'my_status'>): boolean {
  return t.my_status === 'request';
}

export function memberName(m: Pick<InboxMember, 'display_name' | 'username'> | null | undefined): string {
  return m?.display_name || m?.username || 'Someone';
}

/** What the inbox row and chat header call this thread. */
export function threadTitle(t: Pick<InboxThread, 'conversation_type' | 'title' | 'members'>): string {
  if (t.conversation_type === 'group') {
    if (t.title) return t.title;
    const names = t.members.slice(0, 3).map(memberName);
    return names.length > 0 ? names.join(', ') : 'Group chat';
  }
  return memberName(t.members[0]);
}

// ── Messages ───────────────────────────────────────────────────────────────

export interface OutgoingMessage {
  id: string;
  conversationId: string;
  senderId: string;
  content: string | null;
  type: 'text' | 'image';
  mediaUrl?: string | null;
  replyToId?: string | null;
}

export interface InsertResult {
  data: { id: string } | null;
  error: unknown;
}

/**
 * Insert one message under its client-minted id.
 *
 * A duplicate-key answer on a retry means the FIRST attempt landed and only its
 * response was lost. When the row with that id is hers, it is delivered; saying
 * "failed" would invite a third copy.
 */
export async function insertMessage(msg: OutgoingMessage): Promise<InsertResult> {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      id: msg.id,
      conversation_id: msg.conversationId,
      sender_id: msg.senderId,
      content: msg.content,
      media_url: msg.mediaUrl ?? null,
      message_type: msg.type,
      reply_to_id: msg.replyToId ?? null,
    })
    .select('id')
    .single();

  if (error && (error as PgError)?.code === '23505') {
    const { data: existing } = await supabase
      .from('messages')
      .select('id')
      .eq('id', msg.id)
      .maybeSingle();
    if (existing?.id === msg.id) return { data: { id: msg.id }, error: null };
  }
  return { data: (data as { id: string } | null) ?? null, error };
}

/** Edit her own text within 15 minutes; the server stamps edited_at and keeps the original. */
export async function editMessage(messageId: string, content: string): Promise<void> {
  const { data, error } = await supabase
    .from('messages')
    .update({ content })
    .eq('id', messageId)
    .select('id')
    .single();
  if (error) fail(error);
  if (!data) fail({ code: '42501', message: 'edit_window' });
}

/** Unsend within 15 minutes: the words go, the row stays ("Message unsent"). */
export async function unsendMessage(messageId: string): Promise<void> {
  const { data, error } = await supabase
    .from('messages')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', messageId)
    .select('id')
    .single();
  if (error) fail(error);
  if (!data) fail({ code: '42501', message: 'edit_window' });
}

/** Within the 15-minute window? (The server is the judge; this only hides the menu item.) */
export function canStillEdit(createdAt: string, now: number = Date.now()): boolean {
  return now - new Date(createdAt).getTime() < EDIT_WINDOW_MS;
}

// ── Settings ───────────────────────────────────────────────────────────────

export async function fetchChatSettings(): Promise<ChatSettings> {
  const { data } = await supabase
    .from('chat_settings')
    .select('read_receipts, group_add_permission')
    .maybeSingle();
  return { ...DEFAULT_CHAT_SETTINGS, ...((data as Partial<ChatSettings> | null) ?? {}) };
}

export function setChatSettings(patch: {
  readReceipts?: boolean;
  groupAddPermission?: ChatSettings['group_add_permission'];
}): Promise<ChatSettings> {
  return rpc<ChatSettings>('set_chat_settings', {
    p_read_receipts: patch.readReceipts ?? null,
    p_group_add_permission: patch.groupAddPermission ?? null,
  });
}

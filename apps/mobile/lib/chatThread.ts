import type { ChatMessage } from '../hooks/useRealtime';
import { REQUEST_MESSAGE_CAP, type GroupRole, type MemberStatus } from './chat';

/**
 * The rules the chat screen draws by. Pure, so they are tested without a
 * renderer — and so the screen stays about layout, not policy.
 */

export interface ThreadMember {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  last_seen_at: string | null;
  role: GroupRole;
  status: MemberStatus;
  joined_at: string;
  muted_until: string | null;
  /** Her read cursor (own row only matters): draws the "New messages" divider. */
  last_read_at?: string | null;
}

export interface ThreadMeta {
  id: string;
  type: 'direct' | 'group' | 'speed_date' | 'sister';
  title: string | null;
  emoji: string | null;
  createdBy: string | null;
  /** Her own membership row (null on a legacy thread that predates rows). */
  me: ThreadMember | null;
  /** Everyone else she is allowed to see, in join order. */
  others: ThreadMember[];
}

export type GroupedMessage = ChatMessage & {
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  showTimestamp: boolean;
  /** Group chats: the sender's name above the first bubble of her run. */
  showName: boolean;
  isSystem: boolean;
};

const RUN_GAP_MS = 5 * 60 * 1000;
const SEPARATOR_GAP_MS = 20 * 60 * 1000;

function standalone(m: ChatMessage): boolean {
  return m.message_type === 'system' || m.message_type === 'roxy_suggestion';
}

function sameDay(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/** Chronological in, chronological out. */
export function groupMessages(
  messages: ChatMessage[],
  opts: { me: string; isGroup: boolean },
): GroupedMessage[] {
  return messages.map((m, i) => {
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const t = Date.parse(m.created_at);
    const breaksFromPrev = !prev || standalone(prev) || standalone(m)
      || prev.sender_id !== m.sender_id || t - Date.parse(prev.created_at) > RUN_GAP_MS;
    const breaksToNext = !next || standalone(next) || standalone(m)
      || next.sender_id !== m.sender_id || Date.parse(next.created_at) - t > RUN_GAP_MS;
    const showTimestamp = !prev
      || t - Date.parse(prev.created_at) > SEPARATOR_GAP_MS
      || !sameDay(prev.created_at, m.created_at);
    const isSystem = m.message_type === 'system';
    return {
      ...m,
      isFirstInGroup: breaksFromPrev || showTimestamp,
      isLastInGroup: breaksToNext,
      showTimestamp,
      showName: opts.isGroup && !isSystem && m.message_type !== 'roxy_suggestion'
        && m.sender_id !== opts.me && (breaksFromPrev || showTimestamp),
      isSystem,
    };
  });
}

/** Messages she may still send before her request is accepted. Failed sends do not count. */
export function requestMessagesLeft(messages: ChatMessage[], me: string): number {
  const sent = messages.filter(
    (m) => m.sender_id === me && m.message_type !== 'system' && m.deliveryStatus !== 'failed',
  ).length;
  return Math.max(0, REQUEST_MESSAGE_CAP - sent);
}

export type ComposerState =
  | { kind: 'open' }
  /** Someone she isn't friends with wrote; she answers before she can type. */
  | { kind: 'incoming_request' }
  /** She wrote first to someone who isn't her friend: text only, a few messages. */
  | { kind: 'outgoing_request'; remaining: number }
  | { kind: 'gone'; reason: 'left' | 'removed' };

export function composerState(meta: ThreadMeta, messages: ChatMessage[], me: string): ComposerState {
  const mine = meta.me?.status ?? 'active';
  if (mine === 'request') return { kind: 'incoming_request' };
  if (mine === 'left' || mine === 'removed') return { kind: 'gone', reason: mine };
  if (meta.type !== 'direct') return { kind: 'open' };

  // A decline is never revealed: 'declined', 'request' and a row she cannot
  // see all read as "waiting for her to accept".
  const other = meta.others[0];
  if (!other || other.status === 'request' || other.status === 'declined') {
    return { kind: 'outgoing_request', remaining: requestMessagesLeft(messages, me) };
  }
  return { kind: 'open' };
}

const QUOTE_MAX = 120;

/** The quoted line above a reply. Never the words of an unsent message. */
export function replyQuote(
  original: ChatMessage | undefined,
  nameOf: (senderId: string | null) => string,
): { name: string; text: string } {
  if (!original) return { name: '', text: 'Earlier message' };
  const name = nameOf(original.sender_id);
  if (original.deleted_at) return { name, text: 'Message unsent' };
  if (original.message_type === 'image') return { name, text: 'GIF' };
  const words = (original.content ?? '').replace(/\s+/g, ' ').trim();
  return { name, text: words.length > QUOTE_MAX ? `${words.slice(0, QUOTE_MAX)}…` : words };
}

/**
 * CHAT-05: only Roxy may wear Roxy's card. Her suggestions are local rows with
 * no sender; a `roxy_suggestion` row that came from a person (an old row, or a
 * forged one from before migration 132 closed the door) is drawn as an
 * ordinary bubble from that person. Returns the same array when nothing changes.
 */
export function trustRoxy<T extends ChatMessage>(messages: T[]): T[] {
  if (!messages.some((m) => m.message_type === 'roxy_suggestion' && m.sender_id !== null)) return messages;
  return messages.map((m) => (m.message_type === 'roxy_suggestion' && m.sender_id !== null
    ? { ...m, message_type: 'text' as const }
    : m));
}

function displayName(m: Pick<ThreadMember, 'display_name' | 'username'> | undefined): string {
  return m?.display_name || m?.username || 'Someone';
}

export interface ThreadHeader {
  title: string;
  emoji: string | null;
  subtitle: string | null;
  isGroup: boolean;
}

/** What the top of the thread says. */
export function threadHeader(meta: ThreadMeta | null, _me: string): ThreadHeader {
  if (!meta) return { title: 'Chat', emoji: null, subtitle: null, isGroup: false };
  const active = meta.others.filter((o) => o.status === 'active');
  if (meta.type === 'group') {
    const names = active.slice(0, 3).map(displayName);
    const title = meta.title || (names.length ? names.join(', ') : 'Group chat');
    const count = active.length + (meta.me && meta.me.status === 'active' ? 1 : 0);
    return { title, emoji: meta.emoji, subtitle: `${count} member${count === 1 ? '' : 's'}`, isGroup: true };
  }
  return { title: displayName(meta.others[0]), emoji: null, subtitle: null, isGroup: false };
}

/** sender_id → the name a bubble, a quote or a reply bar shows. */
export function senderNamer(meta: ThreadMeta | null, me: string): (senderId: string | null) => string {
  const byId = new Map((meta?.others ?? []).map((o) => [o.id, displayName(o)]));
  return (senderId) => {
    if (senderId === null) return 'Roxy';
    if (senderId === me) return 'You';
    return byId.get(senderId) ?? 'Someone';
  };
}

/**
 * The header's "Report" (CHAT-11). The report table accepts content_type
 * 'message' only for chat (no 'conversation' type yet — ops owns that CHECK),
 * so the report points at her most recent message: moderators open the thread
 * from a real message id instead of a report with no evidence pointer.
 */
export function headerReportTarget(
  messages: ChatMessage[],
  userId: string,
): { userId: string; contentType: 'message'; contentId?: string } {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.sender_id === userId && m.message_type !== 'system') {
      return { userId, contentType: 'message', contentId: m.id };
    }
  }
  return { userId, contentType: 'message' };
}

/** "Until I turn it back on" for mute_conversation. */
export const MUTE_FOREVER = '9999-12-31T00:00:00Z';

export function isMutedUntil(mutedUntil: string | null | undefined, now: number = Date.now()): boolean {
  return !!mutedUntil && Date.parse(mutedUntil) > now;
}

/**
 * Group info: app/chat/info/[id].tsx. chat/[id].tsx is a file route, so the
 * screen can't nest as chat/[id]/info; `/chat/<id>/info` would match nothing.
 */
export function groupInfoPath(conversationId: string): string {
  return `/chat/info/${conversationId}`;
}

/**
 * KeyboardAvoidingView behaviour. iOS pads; Android resizes the window itself
 * (app.json softwareKeyboardLayoutMode 'resize'), so padding there would lift
 * the composer twice; web has no soft keyboard to avoid.
 */
export function keyboardBehavior(os: string): 'padding' | undefined {
  return os === 'ios' ? 'padding' : undefined;
}

export function typingLabel(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} is typing`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing`;
  return `${names[0]} and ${names.length - 1} others are typing`;
}

// Tests for the push pipeline's pure core (_shared/pushCore.ts).
//
// Run from supabase/functions/:
//   deno test --no-check --allow-env _shared/pushCore.test.ts
//
// No network, no database: every decision the dispatcher makes about WHAT to
// send (which type, what words, which channel, quiet hours, merging) and what to
// do with Expo's answer (retry, drop, disable a token) is a pure function here,
// so it is tested here.

import {
  buildMessage,
  categoryOf,
  classifyTicket,
  DEFAULT_PREFS,
  inQuietHours,
  isExpoPushToken,
  type PushPrefs,
  type QueuedNotification,
} from './pushCore.ts';

function eq(actual: unknown, expected: unknown, label = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}\n  expected ${e}\n  received ${a}`);
}
function ok(cond: unknown, label: string) {
  if (!cond) throw new Error(label);
}

const DEFAULTS: PushPrefs = {
  push_enabled: true,
  messages: true,
  friends: true,
  events: true,
  community_chats: true,
  show_previews: false,
  quiet_start: null,
  quiet_end: null,
  timezone: 'UTC',
};

function note(over: Partial<QueuedNotification> = {}): QueuedNotification {
  return {
    id: 'n1',
    user_id: 'u-recipient',
    actor_id: 'u-sender',
    type: 'message',
    title: 'Maya sent you a message',
    body: 'are you coming tonight? 💜',
    link_path: '/chat/c1',
    actor_name: 'Maya',
    ...over,
  };
}

Deno.test('categoryOf maps every notification type to a preference and a channel', () => {
  eq(categoryOf('message'), { pref: 'messages', channel: 'messages' });
  eq(categoryOf('channel_message'), { pref: 'community_chats', channel: 'community' });
  eq(categoryOf('friend_request'), { pref: 'friends', channel: 'friends' });
  eq(categoryOf('friend_accept'), { pref: 'friends', channel: 'friends' });
  eq(categoryOf('community_event'), { pref: 'events', channel: 'events' });
  eq(categoryOf('community_invite'), { pref: 'community_chats', channel: 'community' });
  eq(categoryOf('community_join_request'), { pref: 'community_chats', channel: 'community' });
  eq(categoryOf('something_new'), null, 'unknown types are never pushed');
});

// Migration 134 (G-11): a decision on her application reaches her phone.
Deno.test('membership: application_decided rings on its own channel behind its own switch', () => {
  eq(categoryOf('application_decided'), { pref: 'membership', channel: 'membership' });
  eq(DEFAULT_PREFS.membership, true, 'ON by default like every other type');
  // DEFAULTS (this file) predates the column: a row without it still pushes.
  ok(buildMessage(note({ type: 'application_decided' }), DEFAULTS, 'ExponentPushToken[abc]', false), 'absent pref must mean ON');
});

Deno.test('previews OFF: a membership push says only that there is news', () => {
  for (const [title, body] of [
    ['You\'re in 💜', 'Your membership was approved. Welcome to Roxy.'],
    ['About your membership', 'There\'s an update on your application. Open Roxy to read it.'],
  ]) {
    const m = buildMessage(
      note({ type: 'application_decided', actor_id: null, actor_name: null, title, body, link_path: '/pending' }),
      DEFAULTS, 'ExponentPushToken[abc]', false,
    );
    ok(m, 'expected a membership push');
    eq(m!.title, 'Roxy');
    eq(m!.body, 'There\'s news about your membership');
    eq(m!.channelId, 'membership');
    ok(!/approved|reject|application|welcome/i.test(JSON.stringify([m!.title, m!.body])), 'the decision leaked onto the lock screen');
  }
});

Deno.test('membership switch off: no membership push', () => {
  eq(buildMessage(note({ type: 'application_decided' }), { ...DEFAULTS, membership: false }, 'ExponentPushToken[abc]', false), null);
});

Deno.test('previews OFF: an invite names who asked her, never the community', () => {
  const m = buildMessage(
    note({ type: 'community_invite', actor_name: 'Maya', title: 'Maya invited you to Femme Sapphics Manila', body: 'Join or say not now in Requests', link_path: '/messages?requests=1&community=c9' }),
    DEFAULTS, 'ExponentPushToken[abc]', false,
  );
  eq(m!.title, 'Maya');
  eq(m!.body, 'Invited you to a private community');
  ok(!JSON.stringify(m).includes('Sapphics'), 'community name leaked');
  eq(m!.data.url, 'roxy://messages?requests=1&community=c9');
});

Deno.test('previews OFF: a join request hides the community and her note', () => {
  const m = buildMessage(
    note({ type: 'community_join_request', actor_name: 'Bea', title: 'Bea asked to join Femme Sapphics Manila', body: 'hi, I run the book club', link_path: '/community/members/c9' }),
    DEFAULTS, 'ExponentPushToken[abc]', false,
  );
  eq(m!.title, 'Bea');
  eq(m!.body, 'Asked to join a community you moderate');
  ok(!JSON.stringify(m).includes('Sapphics'), 'community name leaked');
  ok(!JSON.stringify(m).includes('book club'), 'her note leaked');
});

Deno.test('community invites and requests follow the Community chats switch', () => {
  eq(buildMessage(note({ type: 'community_invite' }), { ...DEFAULTS, community_chats: false }, 'ExponentPushToken[abc]', false), null);
  eq(buildMessage(note({ type: 'community_join_request' }), { ...DEFAULTS, community_chats: false }, 'ExponentPushToken[abc]', false), null);
});

Deno.test('previews OFF (the default): a message push names the sender, never the words', () => {
  const m = buildMessage(note(), DEFAULTS, 'ExponentPushToken[abc]', false);
  ok(m, 'expected a message');
  eq(m!.title, 'Maya');
  eq(m!.body, 'New message');
  ok(!JSON.stringify(m).includes('coming tonight'), 'message text leaked into the push');
});

Deno.test('previews OFF: a channel push hides the channel, the community and the words', () => {
  const m = buildMessage(
    note({ type: 'channel_message', title: 'Maya in #lesbian-book-club', body: 'chapter 3 tonight', link_path: '/community/channels/c9' }),
    DEFAULTS, 'ExponentPushToken[abc]', false,
  );
  eq(m!.title, 'Roxy');
  eq(m!.body, 'New message in a community chat');
  ok(!JSON.stringify(m).includes('book-club'), 'channel name leaked');
});

Deno.test('previews OFF: an event push does not name the community', () => {
  const m = buildMessage(
    note({ type: 'community_event', title: 'Dyke March London has a new event', body: 'Pride picnic', link_path: '/event/e1' }),
    DEFAULTS, 'ExponentPushToken[abc]', false,
  );
  eq(m!.title, 'Roxy');
  eq(m!.body, 'A community you joined posted a new event');
  ok(!JSON.stringify(m).includes('Dyke March'), 'community name leaked');
});

Deno.test('previews ON: the real title and body are shown', () => {
  const m = buildMessage(note(), { ...DEFAULTS, show_previews: true }, 'ExponentPushToken[abc]', false);
  eq(m!.title, 'Maya');
  eq(m!.body, 'are you coming tonight? 💜');
});

Deno.test('a type she switched off is not pushed', () => {
  eq(buildMessage(note(), { ...DEFAULTS, messages: false }, 'ExponentPushToken[abc]', false), null);
  eq(buildMessage(note({ type: 'friend_request' }), { ...DEFAULTS, friends: false }, 'ExponentPushToken[abc]', false), null);
});

Deno.test('the master switch off means nothing is pushed', () => {
  eq(buildMessage(note(), { ...DEFAULTS, push_enabled: false }, 'ExponentPushToken[abc]', false), null);
});

Deno.test('the push opens the screen the notification points at, and merges per sender', () => {
  const m = buildMessage(note(), DEFAULTS, 'ExponentPushToken[abc]', false)!;
  eq(m.data.url, 'roxy://chat/c1');
  eq(m.data.notification_id, 'n1');
  eq(m.channelId, 'messages');
  eq(m.collapseId, 'message:u-sender:/chat/c1', 'five messages from Maya replace one another');
  eq(m.threadId, 'message:u-sender:/chat/c1');
});

Deno.test('quiet hours: delivered silently on the quiet channel, not dropped', () => {
  const m = buildMessage(note(), DEFAULTS, 'ExponentPushToken[abc]', true)!;
  eq(m.channelId, 'quiet');
  eq(m.sound, null);
  eq(m.interruptionLevel, 'passive');
  eq(m.priority, 'normal');
});

Deno.test('a link that is not an app path is not turned into a deep link', () => {
  const m = buildMessage(note({ link_path: 'https://evil.example/x' }), DEFAULTS, 'ExponentPushToken[abc]', false)!;
  eq(m.data.url, 'roxy://notifications');
});

Deno.test('inQuietHours handles windows that cross midnight, in her timezone', () => {
  const p = { ...DEFAULTS, quiet_start: '22:00', quiet_end: '07:00', timezone: 'Asia/Manila' }; // UTC+8
  ok(inQuietHours(p, new Date('2026-10-04T15:30:00Z')), '23:30 Manila is quiet');
  ok(inQuietHours(p, new Date('2026-10-04T22:59:00Z')), '06:59 Manila is quiet');
  ok(!inQuietHours(p, new Date('2026-10-04T23:00:00Z')), '07:00 Manila is not quiet');
  ok(!inQuietHours(p, new Date('2026-10-04T04:00:00Z')), '12:00 Manila is not quiet');
});

Deno.test('inQuietHours: same-day window, no window, and a bad timezone fall back safely', () => {
  ok(inQuietHours({ ...DEFAULTS, quiet_start: '13:00', quiet_end: '14:00' }, new Date('2026-10-04T13:30:00Z')), 'inside');
  ok(!inQuietHours({ ...DEFAULTS, quiet_start: '13:00', quiet_end: '14:00' }, new Date('2026-10-04T14:00:00Z')), 'end is exclusive');
  ok(!inQuietHours(DEFAULTS, new Date()), 'no window, never quiet');
  ok(!inQuietHours({ ...DEFAULTS, quiet_start: '13:00', quiet_end: '13:00' }, new Date()), 'empty window');
  ok(inQuietHours({ ...DEFAULTS, quiet_start: '13:00', quiet_end: '14:00', timezone: 'Not/AZone' }, new Date('2026-10-04T13:30:00Z')), 'bad tz -> UTC');
});

Deno.test('isExpoPushToken accepts only Expo push tokens', () => {
  ok(isExpoPushToken('ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]'), 'Exponent form');
  ok(isExpoPushToken('ExpoPushToken[xxxxxxxxxxxxxxxxxxxxxx]'), 'Expo form');
  ok(!isExpoPushToken('fcm-raw-token'), 'raw FCM token');
  ok(!isExpoPushToken(''), 'empty');
  ok(!isExpoPushToken('ExponentPushToken[' + 'x'.repeat(300) + ']'), 'absurd length');
});

Deno.test('classifyTicket: ok, dead token, retryable and permanent errors', () => {
  eq(classifyTicket({ status: 'ok', id: 't1' }), { kind: 'sent', ticketId: 't1' });
  eq(classifyTicket({ status: 'error', message: 'x', details: { error: 'DeviceNotRegistered' } }), { kind: 'dead-token' });
  eq(classifyTicket({ status: 'error', message: 'x', details: { error: 'MessageRateExceeded' } }), { kind: 'retry' });
  eq(classifyTicket({ status: 'error', message: 'x', details: { error: 'MessageTooBig' } }), { kind: 'failed', error: 'MessageTooBig' });
  eq(classifyTicket({ status: 'error', message: 'x', details: { error: 'InvalidCredentials' } }), { kind: 'retry' });
  eq(classifyTicket(undefined), { kind: 'retry' }, 'a missing ticket is retried, not lost');
});

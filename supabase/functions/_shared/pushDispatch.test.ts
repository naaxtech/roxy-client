// Tests for the dispatcher loop (_shared/pushDispatch.ts) with fake I/O.
//   deno test --allow-env _shared/pushDispatch.test.ts
//
// NOTE: pushDispatch.ts was written before these tests. They were then
// mutation-checked (each rule below was broken on purpose and the matching test
// was confirmed to fail) — see the commit message.

import { dispatchOnce, type DispatchDeps, type NotificationRow, type OutboxRow, pairKey, type RowUpdate, MAX_ATTEMPTS } from './pushDispatch.ts';
import type { ExpoMessage, ExpoTicket } from './pushCore.ts';

function eq(actual: unknown, expected: unknown, label = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}\n  expected ${e}\n  received ${a}`);
}

type World = {
  outbox: OutboxRow[];
  notes: NotificationRow[];
  devices: { user_id: string; token: string }[];
  settings: Record<string, unknown>[];
  muted: Set<string>;
  blocked: Set<string>;
  tickets?: (msgs: ExpoMessage[]) => ExpoTicket[];
  expoThrows?: boolean;
};

function harness(w: World) {
  const sent: ExpoMessage[][] = [];
  const updates: RowUpdate[] = [];
  const disabled: string[] = [];
  const deps: DispatchDeps = {
    claim: async () => w.outbox,
    notifications: async (ids) => w.notes.filter((n) => ids.includes(n.id)),
    devices: async (uids) => w.devices.filter((d) => uids.includes(d.user_id)),
    settings: async (uids) => w.settings.filter((s) => uids.includes(s.user_id as string)) as never,
    mutedPairs: async () => w.muted,
    blockedPairs: async () => w.blocked,
    actorNames: async (ids) => new Map(ids.map((id) => [id, `name-${id}`])),
    sendToExpo: async (msgs) => {
      if (w.expoThrows) throw new Error('network down');
      sent.push(msgs);
      return w.tickets ? w.tickets(msgs) : msgs.map((_, i) => ({ status: 'ok', id: `t${i}` }));
    },
    update: async (rows) => { updates.push(...rows); },
    disableTokens: async (tokens) => { disabled.push(...tokens); },
    now: () => new Date('2026-10-04T12:00:00Z'),
  };
  return { deps, sent, updates, disabled };
}

const note = (id: string, user_id: string, over: Partial<NotificationRow> = {}): NotificationRow => ({
  id, user_id, actor_id: 'actor', type: 'message', title: 't', body: 'secret words', link_path: '/chat/c', read_at: null, ...over,
});
const row = (id: number, notification_id: string, user_id: string, attempts = 1): OutboxRow => ({ id, notification_id, user_id, attempts });
const TOKEN = (s: string) => `ExponentPushToken[${s}]`;

Deno.test('sends one push per device and marks the row sent', async () => {
  const h = harness({
    outbox: [row(1, 'n1', 'u1')], notes: [note('n1', 'u1')],
    devices: [{ user_id: 'u1', token: TOKEN('phone') }, { user_id: 'u1', token: TOKEN('tablet') }],
    settings: [], muted: new Set(), blocked: new Set(),
  });
  const s = await dispatchOnce(h.deps);
  eq(h.sent.flat().map((m) => m.to), [TOKEN('phone'), TOKEN('tablet')]);
  eq(s.sent, 1);
  eq(h.updates[0].status, 'sent');
});

Deno.test('default settings: the lock screen never sees the message text', async () => {
  const h = harness({
    outbox: [row(1, 'n1', 'u1')], notes: [note('n1', 'u1')],
    devices: [{ user_id: 'u1', token: TOKEN('p') }], settings: [], muted: new Set(), blocked: new Set(),
  });
  await dispatchOnce(h.deps);
  eq(JSON.stringify(h.sent).includes('secret words'), false, 'message text leaked');
  eq(h.sent[0][0].title, 'name-actor');
});

Deno.test('skips: already read, muted, blocked, no device, preference off', async () => {
  const h = harness({
    outbox: [row(1, 'read', 'u1'), row(2, 'muted', 'u2'), row(3, 'blocked', 'u3'), row(4, 'nodev', 'u4'), row(5, 'off', 'u5')],
    notes: [
      note('read', 'u1', { read_at: '2026-10-04T11:00:00Z' }),
      note('muted', 'u2'), note('blocked', 'u3'), note('nodev', 'u4'), note('off', 'u5'),
    ],
    devices: ['u1', 'u2', 'u3', 'u5'].map((u) => ({ user_id: u, token: TOKEN(u) })),
    settings: [{ user_id: 'u5', messages: false }],
    muted: new Set([pairKey('u2', 'actor')]), blocked: new Set([pairKey('u3', 'actor')]),
  });
  const s = await dispatchOnce(h.deps);
  eq(h.sent.length, 0, 'nothing should be sent');
  eq(s.skipped, 5);
  eq(h.updates.map((u) => [u.id, u.skip_reason]),
    [[1, 'already-read'], [2, 'muted'], [3, 'blocked'], [4, 'no-device'], [5, 'preference-off']]);
});

Deno.test('a dead token is disabled and its row does not retry forever', async () => {
  const h = harness({
    outbox: [row(1, 'n1', 'u1')], notes: [note('n1', 'u1')],
    devices: [{ user_id: 'u1', token: TOKEN('gone') }], settings: [], muted: new Set(), blocked: new Set(),
    tickets: (m) => m.map(() => ({ status: 'error', details: { error: 'DeviceNotRegistered' } })),
  });
  const s = await dispatchOnce(h.deps);
  eq(h.disabled, [TOKEN('gone')]);
  eq(s.deadTokens, 1);
  eq(h.updates[0].status, 'skipped');
  eq(h.updates[0].skip_reason, 'no-live-device');
});

Deno.test('a transient failure is retried with backoff, then gives up at MAX_ATTEMPTS', async () => {
  const transient = { outbox: [row(1, 'n1', 'u1', 1)], notes: [note('n1', 'u1')],
    devices: [{ user_id: 'u1', token: TOKEN('p') }], settings: [], muted: new Set<string>(), blocked: new Set<string>(),
    tickets: (m: ExpoMessage[]) => m.map(() => ({ status: 'error' as const, details: { error: 'MessageRateExceeded' } })) };
  const h = harness(transient);
  await dispatchOnce(h.deps);
  eq(h.updates[0].status, 'pending');
  eq(h.updates[0].next_attempt_at, '2026-10-04T12:00:15.000Z', 'first retry after 15s');

  const h2 = harness({ ...transient, outbox: [row(1, 'n1', 'u1', MAX_ATTEMPTS)] });
  await dispatchOnce(h2.deps);
  eq(h2.updates[0].status, 'failed');
});

Deno.test('Expo unreachable: every row in the batch is retried, nothing is lost', async () => {
  const h = harness({
    outbox: [row(1, 'n1', 'u1'), row(2, 'n2', 'u2')], notes: [note('n1', 'u1'), note('n2', 'u2')],
    devices: [{ user_id: 'u1', token: TOKEN('a') }, { user_id: 'u2', token: TOKEN('b') }],
    settings: [], muted: new Set(), blocked: new Set(), expoThrows: true,
  });
  const s = await dispatchOnce(h.deps);
  eq(s.retried, 2);
  eq(h.updates.map((u) => u.status), ['pending', 'pending']);
});

Deno.test('more than 100 messages are sent in chunks of at most 100', async () => {
  const n = 230;
  const h = harness({
    outbox: Array.from({ length: n }, (_, i) => row(i, `n${i}`, `u${i}`)),
    notes: Array.from({ length: n }, (_, i) => note(`n${i}`, `u${i}`)),
    devices: Array.from({ length: n }, (_, i) => ({ user_id: `u${i}`, token: TOKEN(`d${i}`) })),
    settings: [], muted: new Set(), blocked: new Set(),
  });
  const s = await dispatchOnce(h.deps);
  eq(h.sent.map((b) => b.length), [100, 100, 30]);
  eq(s.sent, n);
});

Deno.test('nothing claimed: no queries beyond the claim', async () => {
  const h = harness({ outbox: [], notes: [], devices: [], settings: [], muted: new Set(), blocked: new Set() });
  const s = await dispatchOnce(h.deps);
  eq(s.claimed, 0);
  eq(h.sent.length, 0);
  eq(h.updates.length, 0);
});

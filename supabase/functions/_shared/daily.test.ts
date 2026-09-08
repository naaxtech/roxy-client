// Regression tests for Daily room-name derivation and room adoption.
//
// Lives in _shared/ so the Supabase CLI does not treat it as a deployable
// function (files under an underscore-prefixed folder are not deployed).
//
// Run from supabase/functions/:
//   deno test --no-check --allow-net --allow-env _shared/daily.test.ts
//
// Why this exists — the worst privacy failure the product could have.
//
// dailyRoomName used to be `roxy-room-${roomId.slice(0, 8)}`. Eight hex
// characters is 32 bits: a birthday collision is ~0.01% at 1,000 rooms and
// ~1.2% at 10,000. ensureDailyRoom then took whatever Daily held under that
// name, so a collision did not fail — it silently ADOPTED the other room.
//
// Both callers check community membership before minting a meeting token, and
// both were satisfied: each caller had a legitimate member of its own
// community. The token was then scoped to the same PHYSICAL Daily room. On a
// WLW app whose private communities include survivor and questioning spaces,
// members of community B walking into community A's live video call is the
// worst thing this codebase can do.
//
// The same 32-bit truncation shipped a second time in join-speed-date-session
// as `roxy-speed-date-${sessionId.slice(0, 8)}`, where a collision drops two
// strangers into someone else's 1:1 date.
//
// Two independent guarantees are asserted here, because the name alone is not
// enough — three other code paths act on a stored daily_room_name (the close
// action deletes the room, kick-participant ejects from it, and migration 042's
// increment_participant_count UPDATEs every row bearing it):
//
//   1. The name is derived from the FULL room id, so two rooms can never
//      derive the same name.
//   2. Nothing acts on a name it cannot prove belongs to the row in hand.
//
// Asserted locally rather than with std/assert: every other module here is
// pinned to a URL specifier, and a test has no business adding another one.

import {
  RoomClaimError,
  dailyRoomName,
  dailySpeedDateRoomName,
  deleteDailyRoom,
  ejectParticipants,
  ensureDailyRoom,
  isRoomNameClaimedBy,
  isValidDailyRoomName,
  legacyDailyRoomName,
  roomNameFromUrl,
} from './daily.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

async function assertRejectsClaim(fn: () => Promise<unknown>, label: string): Promise<void> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof RoomClaimError) return;
    throw new Error(`${label}: expected RoomClaimError, got ${String(e)}`);
  }
  throw new Error(`${label}: expected RoomClaimError, but the call resolved`);
}

function assertThrowsClaim(fn: () => unknown, label: string): void {
  try {
    fn();
  } catch (e) {
    if (e instanceof RoomClaimError) return;
    throw new Error(`${label}: expected RoomClaimError, got ${String(e)}`);
  }
  throw new Error(`${label}: expected RoomClaimError, but the call returned`);
}

// Two rooms in two DIFFERENT communities whose ids share their first 8 hex
// characters — the exact collision the old truncation could not survive.
const ROOM_A = 'a1b2c3d4-1111-4111-8111-111111111111';
const ROOM_B = 'a1b2c3d4-2222-4222-8222-222222222222';
const SESSION_A = 'f0f0f0f0-1111-4111-8111-111111111111';
const SESSION_B = 'f0f0f0f0-2222-4222-8222-222222222222';

const KEY = 'daily-api-key';

// ── Daily stub ───────────────────────────────────────────────────────────────

interface DailyRoom {
  name: string;
  url: string;
}

interface FetchCall {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

interface Stub {
  rooms: Map<string, DailyRoom>;
  calls: FetchCall[];
  restore: () => void;
}

function stubDaily(existing: string[] = []): Stub {
  const rooms = new Map<string, DailyRoom>(
    existing.map((name) => [name, { name, url: `https://roxy.daily.co/${name}` }]),
  );
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;

  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    const body = init?.body === undefined || init.body === null
      ? null
      : JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ method, url, body });

    const json = (value: unknown, status: number): Promise<Response> =>
      Promise.resolve(new Response(JSON.stringify(value), { status }));

    const ejectMatch = url.match(/\/rooms\/([^/]+)\/eject$/);
    if (ejectMatch) {
      return rooms.has(ejectMatch[1]) ? json({ ejected: true }, 200) : json({}, 404);
    }
    if (method === 'POST' && url.endsWith('/rooms')) {
      const name = String(body?.name);
      if (rooms.has(name)) return json({ error: 'name already taken' }, 400);
      const room = { name, url: `https://roxy.daily.co/${name}` };
      rooms.set(name, room);
      return json(room, 200);
    }
    const nameMatch = url.match(/\/rooms\/([^/]+)$/);
    if (nameMatch) {
      const found = rooms.get(nameMatch[1]);
      if (method === 'DELETE') {
        rooms.delete(nameMatch[1]);
        return json({ deleted: true }, 200);
      }
      return found ? json(found, 200) : json({ error: 'not found' }, 404);
    }
    return json({ error: 'unexpected request' }, 500);
  }) as typeof fetch;

  return { rooms, calls, restore: () => { globalThis.fetch = original; } };
}

async function withDaily(existing: string[], fn: (stub: Stub) => Promise<void>): Promise<void> {
  const stub = stubDaily(existing);
  try {
    await fn(stub);
  } finally {
    stub.restore();
  }
}

// ── Name derivation ──────────────────────────────────────────────────────────

Deno.test('two room ids sharing their first 8 characters derive different names', () => {
  const a = dailyRoomName(ROOM_A);
  const b = dailyRoomName(ROOM_B);

  assert(a !== b, `collision: both communities derived ${a}`);
  // The whole id has to be in the name, or some prefix length is still the bound.
  assert(a.includes(ROOM_A.replace(/-/g, '')), 'name must carry the full room id');
});

Deno.test('two session ids sharing their first 8 characters derive different names', () => {
  assert(
    dailySpeedDateRoomName(SESSION_A) !== dailySpeedDateRoomName(SESSION_B),
    'two speed dates would share one physical room',
  );
});

Deno.test('a community room and a speed date can never derive the same name', () => {
  // Same uuid used for both would collide if the prefixes were not distinct.
  assert(
    dailyRoomName(ROOM_A) !== dailySpeedDateRoomName(ROOM_A),
    'namespaces must not overlap',
  );
});

Deno.test('derived names obey Daily’s documented name grammar', () => {
  // A room name can include only uppercase and lowercase ASCII letters,
  // numbers, dash and underscore, and cannot exceed 128 characters.
  // src: https://docs.daily.co/reference/rest-api/rooms/create-room · Daily REST v1 · 2026-08-07
  for (const name of [
    dailyRoomName(ROOM_A),
    legacyDailyRoomName(ROOM_A),
    dailySpeedDateRoomName(SESSION_A),
  ]) {
    assert(/^[A-Za-z0-9_-]+$/.test(name), `illegal characters in ${name}`);
    assert(name.length <= 128, `${name} is ${name.length} chars, over Daily's limit`);
    // Deliberately far inside the limit: 41 is the shortest bound quoted for a
    // Daily room name anywhere, and these must be safe under every candidate.
    assert(name.length <= 41, `${name} is ${name.length} chars, too close to the bound`);
  }
});

Deno.test('a room name is refused for anything that is not a uuid', () => {
  for (const bad of ['', 'not-a-uuid', '../../rooms/someone-elses-room', 'a1b2c3d4']) {
    assertThrowsClaim(() => dailyRoomName(bad), `dailyRoomName(${bad})`);
  }
});

Deno.test('roomNameFromUrl refuses a name that is not a legal Daily name', () => {
  assertEquals(
    roomNameFromUrl('https://roxy.daily.co/roxy-room-a1b2c3d4?t=1'),
    'roxy-room-a1b2c3d4',
    'plain recovery still works',
  );
  assertEquals(roomNameFromUrl('https://roxy.daily.co/'), null, 'no name in url');
  assertEquals(roomNameFromUrl('https://roxy.daily.co/bad name'), null, 'illegal characters');
});

Deno.test('isRoomNameClaimedBy accepts only names this room id can derive', () => {
  assert(isRoomNameClaimedBy(dailyRoomName(ROOM_A), ROOM_A), 'canonical name');
  assert(isRoomNameClaimedBy(legacyDailyRoomName(ROOM_A), ROOM_A), 'legacy name');
  // The collision itself: room B must NOT be able to claim room A's canonical name.
  assert(!isRoomNameClaimedBy(dailyRoomName(ROOM_A), ROOM_B), 'another room’s canonical name');
  assert(!isRoomNameClaimedBy('roxy-some-other-room', ROOM_A), 'unrelated name');
});

// ── ensureDailyRoom ──────────────────────────────────────────────────────────

Deno.test('ensureDailyRoom refuses to adopt a room this row has no claim to', async () => {
  // The row somehow holds a name it could never have derived. Before the fix
  // this was reachable through an 8-hex collision; it must now be refused
  // rather than silently handing back somebody else's live call.
  await withDaily([dailyRoomName(ROOM_A)], async (stub) => {
    await assertRejectsClaim(
      () => ensureDailyRoom({ roomId: ROOM_B, storedName: dailyRoomName(ROOM_A) }, 50, KEY),
      'mismatched adoption',
    );
    assertEquals(stub.calls.length, 0, 'refusal must happen before any request to Daily');
  });
});

Deno.test('ensureDailyRoom adopts the room it can prove is its own', async () => {
  const canonical = dailyRoomName(ROOM_A);
  await withDaily([canonical], async (stub) => {
    const ensured = await ensureDailyRoom({ roomId: ROOM_A, storedName: canonical }, 50, KEY);

    assertEquals(ensured.name, canonical, 'adopted its own room');
    assertEquals(stub.calls.filter((c) => c.method === 'POST').length, 0, 'no room created');
  });
});

Deno.test('ensureDailyRoom keeps a call that is already live under a legacy name', async () => {
  // A room opened by the old code is still running under the short name. The
  // members in it must not be split off into a second room mid-call.
  const legacy = legacyDailyRoomName(ROOM_A);
  await withDaily([legacy], async () => {
    const ensured = await ensureDailyRoom({ roomId: ROOM_A, storedName: legacy }, 50, KEY);
    assertEquals(ensured.name, legacy, 'stayed in the live call');
  });
});

Deno.test('ensureDailyRoom never mints a new room under a legacy short name', async () => {
  // The legacy room has expired (Daily 404s it), so there is nothing to
  // preserve — and no reason to recreate a name that can collide.
  const legacy = legacyDailyRoomName(ROOM_A);
  await withDaily([], async (stub) => {
    const ensured = await ensureDailyRoom({ roomId: ROOM_A, storedName: legacy }, 50, KEY);

    assertEquals(ensured.name, dailyRoomName(ROOM_A), 'created under the canonical name');
    const created = stub.calls.filter((c) => c.method === 'POST');
    assertEquals(created.length, 1, 'exactly one create');
    assertEquals(created[0].body?.name, dailyRoomName(ROOM_A), 'never the short name');
  });
});

Deno.test('ensureDailyRoom creates a private room with the agreed shape', async () => {
  await withDaily([], async (stub) => {
    await ensureDailyRoom({ roomId: ROOM_A, storedName: null }, 12, KEY);

    const created = stub.calls.find((c) => c.method === 'POST');
    // Private is what makes the membership check meaningful: on a public room
    // the URL alone is enough to join, with or without a token.
    assertEquals(created?.body?.privacy, 'private', 'room must be private');
    const props = created?.body?.properties as Record<string, unknown>;
    assertEquals(props.max_participants, 12, 'max participants honoured');
    assertEquals(props.eject_at_room_exp, true, 'participants ejected at expiry');
  });
});

Deno.test('ensureDailyRoom adopts a concurrently-created canonical room instead of failing', async () => {
  // Two members tap join at once: the second finds the room already there.
  // Daily refuses a duplicate name, so a blind create would 500 on her.
  const canonical = dailyRoomName(ROOM_A);
  await withDaily([canonical], async () => {
    const ensured = await ensureDailyRoom(
      { roomId: ROOM_A, storedName: legacyDailyRoomName(ROOM_A) }, 50, KEY,
    );
    assertEquals(ensured.name, canonical, 'fell through to the existing canonical room');
  });
});

Deno.test('ensureDailyRoom surfaces a lookup failure rather than creating a duplicate', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response('{}', { status: 500 }))) as typeof fetch;
  try {
    let threw = false;
    try {
      await ensureDailyRoom({ roomId: ROOM_A, storedName: null }, 50, KEY);
    } catch (e) {
      threw = true;
      assert(!(e instanceof RoomClaimError), 'a Daily outage is not a claim failure');
    }
    assert(threw, 'a 500 from Daily must not be treated as "room does not exist"');
  } finally {
    globalThis.fetch = original;
  }
});

// ── Acting on a stored name: delete and eject ────────────────────────────────

Deno.test('deleteDailyRoom refuses to delete a room this row has no claim to', async () => {
  // Ending room B must never tear down community A's live call.
  await withDaily([dailyRoomName(ROOM_A)], async (stub) => {
    await assertRejectsClaim(
      () => deleteDailyRoom({ roomId: ROOM_B, storedName: dailyRoomName(ROOM_A) }, KEY),
      'cross-room delete',
    );
    assertEquals(stub.calls.length, 0, 'no request may reach Daily');
    assert(stub.rooms.has(dailyRoomName(ROOM_A)), 'community A’s room must survive');
  });
});

Deno.test('deleteDailyRoom deletes its own room', async () => {
  const canonical = dailyRoomName(ROOM_A);
  await withDaily([canonical], async (stub) => {
    await deleteDailyRoom({ roomId: ROOM_A, storedName: canonical }, KEY);
    assert(!stub.rooms.has(canonical), 'room deleted');
  });
});

Deno.test('ejectParticipants refuses to eject from a room this row has no claim to', async () => {
  // A moderator of community B must not be able to eject community A's members.
  await withDaily([dailyRoomName(ROOM_A)], async (stub) => {
    await assertRejectsClaim(
      () => ejectParticipants({ roomId: ROOM_B, storedName: dailyRoomName(ROOM_A) }, ['s1'], KEY),
      'cross-room eject',
    );
    assertEquals(stub.calls.length, 0, 'no request may reach Daily');
  });
});

Deno.test('ejectParticipants ejects from its own room', async () => {
  const canonical = dailyRoomName(ROOM_A);
  await withDaily([canonical], async (stub) => {
    await ejectParticipants({ roomId: ROOM_A, storedName: canonical }, ['s1'], KEY);

    const call = stub.calls.find((c) => c.url.endsWith('/eject'));
    assert(call !== undefined, 'eject issued');
    assertEquals(call?.body?.ids, ['s1'], 'session ids forwarded');
  });
});

Deno.test('isValidDailyRoomName rejects names Daily would reject', () => {
  assert(isValidDailyRoomName('roxy-abc_123'), 'legal name');
  assert(!isValidDailyRoomName(''), 'empty');
  assert(!isValidDailyRoomName('roxy/abc'), 'slash would change the request path');
  assert(!isValidDailyRoomName('a'.repeat(129)), 'over 128 characters');
});

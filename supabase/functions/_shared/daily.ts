// Shared Daily.co room provisioning.
//
// join-community-room and manage-room both need a Daily room for the same Roxy
// room, and they used to each carry their own copy of "derive a name, create a
// room". The copies had drifted: one created rooms with chat on and screenshare
// off, the other with screenshare on and chat off, so a room's features depended
// on whether a host opened it from the studio or a member joined it from mobile
// first. Whichever ran first won, silently.
//
// One definition, used by both. If a room's shape needs to change, it changes here.
// src: https://docs.daily.co/reference/rest-api/rooms/create-room · Daily REST v1 · 2026-08-02

const DAILY_API = 'https://api.daily.co/v1';

/** 12h — long enough for any scheduled community room, short enough that an abandoned room self-cleans. */
export const ROOM_TTL_SECONDS = 43200;

// Daily's room-name grammar: "A room name can include only the uppercase and
// lowercase ASCII letters, numbers, dash and underscore… the regexp that
// detects an invalid room name is /[^A-Za-z0-9_-]/… the room name cannot exceed
// 128 characters."
// src: https://docs.daily.co/reference/rest-api/rooms/create-room · Daily REST v1 · 2026-08-07
const DAILY_NAME_MAX_LENGTH = 128;
const DAILY_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A Daily room name could not be proven to belong to the row acting on it.
 *
 * Distinct from a transport failure on purpose: callers must answer this with
 * "reopen the room", never with a retry, and must never fall back to acting on
 * the name anyway.
 */
export class RoomClaimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoomClaimError';
  }
}

/**
 * A Roxy room id together with the daily_room_name currently stored on its row.
 *
 * These travel together because neither is sufficient alone: the id is the only
 * authority for which Daily room this row may touch, and the stored name is the
 * only way to find a call that is already in progress.
 */
export interface RoomIdentity {
  /** community_rooms.id — the authority. Never a client-supplied value. */
  roomId: string;
  /** community_rooms.daily_room_name, or null when the row has never held one. */
  storedName: string | null;
}

function assertUuid(id: string): void {
  if (!UUID_PATTERN.test(id)) {
    // No id in the message: it ends up in logs.
    throw new RoomClaimError('room id is not a uuid');
  }
}

/** True when `name` is something Daily would accept and we would route safely. */
export function isValidDailyRoomName(name: string): boolean {
  return name.length > 0 &&
    name.length <= DAILY_NAME_MAX_LENGTH &&
    DAILY_NAME_PATTERN.test(name);
}

/**
 * The canonical Daily room name for a Roxy room id. Both functions MUST derive
 * the same name: if they disagree, one mints a meeting token for one room and
 * hands the client the URL of another, and Daily rejects the join.
 *
 * The FULL id goes in. This used to be `roxy-room-${roomId.slice(0, 8)}`, and
 * eight hex characters is 32 bits — a birthday collision at ~0.01% for 1,000
 * rooms and ~1.2% at 10,000. Two communities colliding did not fail loudly;
 * ensureDailyRoom adopted whichever room already existed under the name, and
 * each caller then minted a token — after its own membership check — scoped to
 * the same PHYSICAL room. Members of one community walked into another's live
 * video call. On a WLW app whose private communities include survivor and
 * questioning spaces, that is the worst failure in the product.
 *
 * 5 + 32 = 37 characters of [a-z0-9-], comfortably inside Daily's 128.
 */
export function dailyRoomName(roomId: string): string {
  assertUuid(roomId);
  return `roxy-${roomId.replace(/-/g, '').toLowerCase()}`;
}

/**
 * The truncated name this room id would have produced before the fix.
 *
 * Kept for exactly two jobs: recognising a name a pre-fix row legitimately
 * stored, and rejoining a call that is still running under it. Never used to
 * mint a new room.
 */
export function legacyDailyRoomName(roomId: string): string {
  assertUuid(roomId);
  return `roxy-room-${roomId.slice(0, 8).toLowerCase()}`;
}

/**
 * The canonical Daily room name for a speed-date session.
 *
 * Carried the same 32-bit truncation (`roxy-speed-date-${id.slice(0, 8)}`),
 * where a collision drops two strangers into someone else's 1:1 date. The
 * `roxy-sd-` prefix cannot collide with a community room name: after `roxy-`
 * that form is exactly 32 hex characters, this one is 35.
 */
export function dailySpeedDateRoomName(sessionId: string): string {
  assertUuid(sessionId);
  return `roxy-sd-${sessionId.replace(/-/g, '').toLowerCase()}`;
}

/**
 * Recover the room name from a stored URL, for rows written before
 * daily_room_name existed. Returns null unless the result is a name Daily would
 * accept — the value is interpolated into a request path, so a stored URL that
 * is not what we think it is must not be able to redirect the request.
 */
export function roomNameFromUrl(url: string): string | null {
  const path = url.split('?')[0].replace(/\/+$/, '');
  const name = path.slice(path.lastIndexOf('/') + 1);
  return isValidDailyRoomName(name) ? name : null;
}

/**
 * Can `roomId` prove that `name` is its own room?
 *
 * True only for the two names this id can derive. This is what makes a name
 * collision unable to become a privacy breach: a row may act on a Daily room
 * only when the room's name is one it could have minted itself.
 */
export function isRoomNameClaimedBy(name: string, roomId: string): boolean {
  if (!isValidDailyRoomName(name) || !UUID_PATTERN.test(roomId)) return false;
  return name === dailyRoomName(roomId) || name === legacyDailyRoomName(roomId);
}

function assertClaim(identity: RoomIdentity): string {
  const { roomId, storedName } = identity;
  assertUuid(roomId);
  if (storedName === null) {
    throw new RoomClaimError('room has no daily room name');
  }
  if (!isRoomNameClaimedBy(storedName, roomId)) {
    throw new RoomClaimError('stored daily room name is not derivable from this room id');
  }
  return storedName;
}

/** GET a room by name. null on a definite 404; throws on anything else. */
async function lookupRoom(
  roomName: string,
  apiKey: string,
): Promise<{ url: string; name: string } | null> {
  const res = await fetch(`${DAILY_API}/rooms/${roomName}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (res.ok) {
    const existing = await res.json();
    return { url: existing.url as string, name: existing.name as string };
  }
  if (res.status === 404) return null;
  throw new Error(`room lookup failed (HTTP ${res.status})`);
}

async function createRoom(
  roomName: string,
  maxParticipants: number | null,
  apiKey: string,
): Promise<{ url: string; name: string }> {
  const res = await fetch(`${DAILY_API}/rooms`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: roomName,
      // Without this Daily defaults to public, and the room URL alone would let
      // anyone bypass the community-membership check the callers perform.
      privacy: 'private',
      properties: {
        max_participants: maxParticipants ?? 50,
        enable_chat: true,
        enable_screenshare: true,
        exp: Math.floor(Date.now() / 1000) + ROOM_TTL_SECONDS,
        // A ROOM property. Daily rejects a meeting TOKEN that carries it
        // (invalid-request-error) — never copy this into createMeetingToken.
        eject_at_room_exp: true,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`room creation failed (HTTP ${res.status})`);
  }
  const created = await res.json();
  return { url: created.url as string, name: created.name as string };
}

/**
 * Return a Daily room that exists *right now*, creating it only if it does not.
 *
 * A stored daily_room_url proves only that a room once existed: rooms carry an
 * `exp` and Daily removes them when it passes, while the row keeps the URL
 * indefinitely. Handing that stale URL to a client produced an opaque connection
 * failure. Going straight to POST instead is no better — Daily rejects a create
 * for a name that already exists, which turned "go live again" into a 500.
 *
 * So: look it up, and create only on a definite 404.
 *
 * This takes the room id rather than a bare name because a name on its own
 * cannot be checked. It used to accept whatever name it was handed and return
 * whatever Daily held under it, which is what turned an 8-hex collision into
 * two communities sharing one call. Now the row must be able to derive the name
 * it is asking for, and a new room is only ever minted under the canonical
 * full-id name — a legacy short name is followed while a call is still running
 * under it, and never recreated once it is gone.
 */
export async function ensureDailyRoom(
  identity: RoomIdentity,
  maxParticipants: number | null,
  apiKey: string,
): Promise<{ url: string; name: string }> {
  const canonical = dailyRoomName(identity.roomId);

  if (identity.storedName !== null) {
    // Refuse before touching the network: acting on an unclaimable name is the
    // breach, and a request that never leaves is the only certain way not to.
    assertClaim(identity);

    if (identity.storedName !== canonical) {
      // A pre-fix call may still be running under the short name. Splitting the
      // people in it into a second room would be its own outage.
      const live = await lookupRoom(identity.storedName, apiKey);
      if (live) return live;
    }
  }

  // Also covers the race where a concurrent join minted the canonical room a
  // moment ago — Daily refuses a duplicate name, so a blind create would 500.
  const existing = await lookupRoom(canonical, apiKey);
  if (existing) return existing;

  return await createRoom(canonical, maxParticipants, apiKey);
}

/**
 * Delete a Daily room. Used when a host ends a room for everyone.
 *
 * Takes the identity, not a bare name: deleting by an unverified stored name is
 * how one community's host could have torn down another community's live call.
 */
export async function deleteDailyRoom(identity: RoomIdentity, apiKey: string): Promise<void> {
  const roomName = assertClaim(identity);
  await fetch(`${DAILY_API}/rooms/${roomName}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

/**
 * Eject participants from a room by their Daily session ids.
 *
 * Same reason as deleteDailyRoom for taking the identity: without the claim
 * check a moderator of one community could eject members of another.
 */
export async function ejectParticipants(
  identity: RoomIdentity,
  sessionIds: string[],
  apiKey: string,
): Promise<void> {
  const roomName = assertClaim(identity);
  const res = await fetch(`${DAILY_API}/rooms/${roomName}/eject`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: sessionIds }),
  });

  if (!res.ok) {
    // Daily's body can echo request detail; keep it out of anything client-visible.
    throw new Error(`participant eject failed (HTTP ${res.status})`);
  }
}

/**
 * Mint a per-user meeting token. Private rooms cannot be joined without one.
 *
 * `is_owner` is what authorises the host-only controls (mute, eject) in both
 * clients, so it must be decided server-side from the caller's community role
 * and never accepted from the request body.
 * src: https://docs.daily.co/reference/rest-api/meeting-tokens/create-meeting-token · Daily REST v1 · 2026-08-02
 */
export async function createMeetingToken(
  roomName: string,
  userName: string,
  userId: string,
  isOwner: boolean,
  apiKey: string,
): Promise<string> {
  const res = await fetch(`${DAILY_API}/meeting-tokens`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      properties: {
        room_name: roomName,
        user_name: userName,
        user_id: userId,
        is_owner: isOwner,
        start_audio_off: true,
        // NOTE: eject_at_room_exp is a ROOM property, not a token property —
        // Daily rejects tokens that include it (invalid-request-error).
      },
    }),
  });

  if (!res.ok) {
    // The body can echo request detail; keep it out of anything client-visible.
    throw new Error(`meeting token creation failed (HTTP ${res.status})`);
  }
  return (await res.json()).token as string;
}

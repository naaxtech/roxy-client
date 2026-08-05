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

/**
 * The canonical Daily room name for a Roxy room id. Both functions MUST derive
 * the same name: if they disagree, one mints a meeting token for one room and
 * hands the client the URL of another, and Daily rejects the join.
 */
export function dailyRoomName(roomId: string): string {
  return `roxy-room-${roomId.slice(0, 8)}`;
}

/** Recover the room name from a stored URL, for rows written before daily_room_name existed. */
export function roomNameFromUrl(url: string): string | null {
  const path = url.split('?')[0].replace(/\/+$/, '');
  const name = path.slice(path.lastIndexOf('/') + 1);
  return name.length > 0 ? name : null;
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
 */
export async function ensureDailyRoom(
  roomName: string,
  maxParticipants: number | null,
  apiKey: string,
): Promise<{ url: string; name: string }> {
  const getRes = await fetch(`${DAILY_API}/rooms/${roomName}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (getRes.ok) {
    const existing = await getRes.json();
    return { url: existing.url as string, name: existing.name as string };
  }
  if (getRes.status !== 404) {
    throw new Error(`room lookup failed (HTTP ${getRes.status})`);
  }

  const createRes = await fetch(`${DAILY_API}/rooms`, {
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

  if (!createRes.ok) {
    throw new Error(`room creation failed (HTTP ${createRes.status})`);
  }
  const created = await createRes.json();
  return { url: created.url as string, name: created.name as string };
}

/** Delete a Daily room. Used when a host ends a room for everyone. */
export async function deleteDailyRoom(roomName: string, apiKey: string): Promise<void> {
  await fetch(`${DAILY_API}/rooms/${roomName}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${apiKey}` },
  });
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

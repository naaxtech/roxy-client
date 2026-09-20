/**
 * Who may open a direct conversation with her.
 *
 * The prototype's Settings row cycles three values (markup 896, behaviour
 * 1637). They live on `profiles.dm_permission`, added by migration 093 and
 * enforced there by a trigger on `conversations` — the client shows and writes
 * the preference, it does not police it. A rule the client checks is a rule an
 * attacker skips, and the person who must not be able to skip this one is
 * precisely the person it exists to stop.
 *
 * Nothing here is derived by elimination. This codebase has twice shipped a bug
 * where a third value fell through a `!== 'x'` branch and was handled as its
 * opposite, and the version of that mistake living here would decide who is
 * allowed to message a woman who asked to be left alone.
 *
 * src: docs/handoff/roxy-3.0/Roxy App.dc.html · markup 896, behaviour 1637 · 2026-09-01
 */

export const DM_PERMISSIONS = ['friends', 'friends_of_friends', 'everyone'] as const;

export type DmPermission = (typeof DM_PERMISSIONS)[number];

/**
 * What the app does when it cannot tell.
 *
 * `everyone` is the permissive end, and choosing it as the fallback is
 * deliberate rather than lazy: migration 093 is written and NOT applied, so
 * until a human runs it the column is absent from every profile row, and the
 * app must behave exactly as it does today — anyone may message, and the
 * request-first inbox files strangers under Requests. Defaulting to `friends`
 * instead would silently cut off every existing conversation on a branch whose
 * schema has not changed.
 */
export const DEFAULT_DM_PERMISSION: DmPermission = 'everyone';

const LABELS: Record<DmPermission, string> = {
  friends: 'Friends only',
  friends_of_friends: 'Friends of friends',
  // The prototype's own wording. It says what happens to everyone else, which
  // is the part that makes the permissive option safe to choose.
  everyone: 'Everyone — requests first',
};

const DESCRIPTIONS: Record<DmPermission, string> = {
  friends: 'Only women you have accepted can start a chat.',
  friends_of_friends: 'Women who share a friend with you can start a chat.',
  everyone: 'Anyone can start a chat. Strangers land in Requests until you answer.',
};

export function dmPermissionLabel(permission: DmPermission): string {
  return LABELS[permission];
}

export function dmPermissionDescription(permission: DmPermission): string {
  return DESCRIPTIONS[permission];
}

function isDmPermission(value: unknown): value is DmPermission {
  return DM_PERMISSIONS.includes(value as DmPermission);
}

/**
 * The stored value, or the default — never whatever happened to be in the row.
 *
 * An unrecognised value is not passed through. A row written by a newer client,
 * or by hand, must not end up meaning "the most permissive setting" just
 * because nothing here matched it.
 */
export function readDmPermission(profile: { dm_permission?: unknown } | null | undefined): DmPermission {
  const stored = profile?.dm_permission;
  return isDmPermission(stored) ? stored : DEFAULT_DM_PERMISSION;
}

/** The next value in the prototype's cycle, wrapping at the end. */
export function nextDmPermission(current: DmPermission | null | undefined): DmPermission {
  const from = isDmPermission(current) ? current : DEFAULT_DM_PERMISSION;
  const index = DM_PERMISSIONS.indexOf(from);
  return DM_PERMISSIONS[(index + 1) % DM_PERMISSIONS.length];
}

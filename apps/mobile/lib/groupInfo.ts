import type { GroupRole } from './chat';
import { GROUP_MAX_MEMBERS } from './chat';
import type { ThreadMember, ThreadMeta } from './chatThread';

/**
 * The rules the Group info screen draws by — the same ones the 132 RPCs
 * enforce (remove_group_member, set_group_role, rename_group,
 * add_group_members, mute_conversation). The server has the last word; these
 * only decide which buttons she is shown, so nobody taps a "Remove" that will
 * always be refused. Pure, so they are tested without a renderer.
 */

/** Group avatars: one tap, no upload, nothing to moderate. */
export const GROUP_EMOJIS = ['🌈', '💜', '✨', '🔥', '🌸', '🎉', '☕', '🍕', '🎮', '📚', '🏳️‍⚧️', '🏳️‍🌈'];

/** conversations_title_len CHECK. */
export const GROUP_TITLE_MAX = 60;

/** "Until I turn it back on": stored as a date far enough away to never arrive. */
export const MUTE_FOREVER = '2999-12-31T00:00:00.000Z';

export type MuteChoice = '1h' | '8h' | '1w' | 'always';

export const MUTE_CHOICES: { key: MuteChoice; label: string }[] = [
  { key: '1h', label: 'For 1 hour' },
  { key: '8h', label: 'For 8 hours' },
  { key: '1w', label: 'For a week' },
  { key: 'always', label: 'Until I turn it back on' },
];

const HOUR = 60 * 60 * 1000;
const MUTE_MS: Record<Exclude<MuteChoice, 'always'>, number> = {
  '1h': HOUR,
  '8h': 8 * HOUR,
  '1w': 7 * 24 * HOUR,
};

export function muteUntil(choice: MuteChoice, now: number = Date.now()): string {
  if (choice === 'always') return MUTE_FOREVER;
  return new Date(now + MUTE_MS[choice]).toISOString();
}

export function isMuted(until: string | null | undefined, now: number = Date.now()): boolean {
  return !!until && Date.parse(until) > now;
}

export function muteLabel(until: string | null | undefined, now: number = Date.now()): string {
  if (!isMuted(until, now)) return 'Notifications on';
  const t = Date.parse(until as string);
  // A year out reads as "until I turn it back on".
  if (t - now > 365 * 24 * HOUR) return 'Muted';
  const d = new Date(t);
  const sameDay = d.toDateString() === new Date(now).toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay
    ? `Muted until ${time}`
    : `Muted until ${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`;
}

const RANK: Record<GroupRole, number> = { owner: 3, admin: 2, member: 1 };

export function canEditGroup(myRole: GroupRole | null | undefined): boolean {
  return myRole === 'owner' || myRole === 'admin';
}

/** Owner removes anyone else; an admin removes members only. */
export function canRemove(myRole: GroupRole | null | undefined, target: ThreadMember): boolean {
  if (target.status !== 'active') return false;
  if (myRole === 'owner') return target.role !== 'owner';
  if (myRole === 'admin') return target.role === 'member';
  return false;
}

/** Only the owner promotes or demotes, and the owner role is not hers to give here. */
export function canChangeRole(myRole: GroupRole | null | undefined, target: ThreadMember): boolean {
  return myRole === 'owner' && target.status === 'active' && target.role !== 'owner';
}

export function roleLabel(role: GroupRole): string {
  if (role === 'owner') return 'Owner';
  if (role === 'admin') return 'Admin';
  return '';
}

/** Everyone in the group now (her included), owner → admins → members, then by join. */
export function activeMembers(meta: ThreadMeta): ThreadMember[] {
  const all = [...(meta.me ? [meta.me] : []), ...meta.others].filter((m) => m.status === 'active');
  const myId = meta.me?.id;
  return all
    .map((m, i) => ({ m, i }))
    .sort((a, b) => {
      const r = RANK[b.m.role] - RANK[a.m.role];
      if (r !== 0) return r;
      if (a.m.id === myId) return -1;
      if (b.m.id === myId) return 1;
      return a.m.joined_at.localeCompare(b.m.joined_at) || a.i - b.i;
    })
    .map(({ m }) => m);
}

/** Free seats under the 32 cap, her included. */
export function slotsLeft(meta: ThreadMeta): number {
  return Math.max(0, GROUP_MAX_MEMBERS - activeMembers(meta).length);
}

type FriendLike = { profile: { id: string; display_name: string | null; username: string | null } };

/**
 * Friends she could add: anyone not active in the group now. Someone who left
 * can be asked back; whether she takes group adds is her setting, checked by
 * the server (a refusal is skipped, and the RPC says how many it added).
 */
export function addableFriends(friends: FriendLike[], meta: ThreadMeta): FriendLike['profile'][] {
  const inGroup = new Set(activeMembers(meta).map((m) => m.id));
  return friends
    .map((f) => f.profile)
    .filter((p) => !inGroup.has(p.id))
    .sort((a, b) => (a.display_name ?? a.username ?? '').localeCompare(b.display_name ?? b.username ?? ''));
}

import {
  canEditGroup, canRemove, canChangeRole, activeMembers, slotsLeft, addableFriends,
  muteUntil, muteLabel, isMuted, roleLabel, MUTE_FOREVER,
} from '../../lib/groupInfo';
import type { ThreadMember, ThreadMeta } from '../../lib/chatThread';

/**
 * Group info draws by the same rules the 132 RPCs enforce. The server has the
 * last word; these decide only which buttons she is shown, so a member never
 * taps a "Remove" that will always be refused.
 */
const member = (id: string, role: ThreadMember['role'] = 'member', status: ThreadMember['status'] = 'active'): ThreadMember => ({
  id, display_name: id.toUpperCase(), username: id, avatar_url: null, last_seen_at: null,
  role, status, joined_at: '2026-01-01T00:00:00Z', muted_until: null,
});

const meta = (me: ThreadMember, others: ThreadMember[]): ThreadMeta => ({
  id: 'g', type: 'group', title: 'Weekend crew', emoji: '🌈', createdBy: 'me', me, others,
});

describe('who may do what (mirrors remove_group_member / set_group_role / rename_group)', () => {
  it('owner and admins edit the name; members do not', () => {
    expect(canEditGroup('owner')).toBe(true);
    expect(canEditGroup('admin')).toBe(true);
    expect(canEditGroup('member')).toBe(false);
    expect(canEditGroup(null)).toBe(false);
  });

  it('the owner removes admins and members, never herself', () => {
    expect(canRemove('owner', member('a', 'admin'))).toBe(true);
    expect(canRemove('owner', member('m'))).toBe(true);
  });

  it('an admin removes members but not another admin or the owner', () => {
    expect(canRemove('admin', member('m'))).toBe(true);
    expect(canRemove('admin', member('a', 'admin'))).toBe(false);
    expect(canRemove('admin', member('o', 'owner'))).toBe(false);
  });

  it('a member removes nobody', () => {
    expect(canRemove('member', member('m'))).toBe(false);
  });

  it('someone who already left cannot be removed again', () => {
    expect(canRemove('owner', member('m', 'member', 'left'))).toBe(false);
  });

  it('only the owner changes roles, and never the owner role', () => {
    expect(canChangeRole('owner', member('m'))).toBe(true);
    expect(canChangeRole('owner', member('a', 'admin'))).toBe(true);
    expect(canChangeRole('admin', member('m'))).toBe(false);
    expect(canChangeRole('owner', member('o', 'owner'))).toBe(false);
  });
});

describe('membership and the 32 cap', () => {
  it('lists active members only, owner then admins then members, her first within her rank', () => {
    const m = meta(member('me', 'admin'), [
      member('zed'), member('own', 'owner'), member('gone', 'member', 'left'), member('adm', 'admin'),
    ]);
    expect(activeMembers(m).map((x) => x.id)).toEqual(['own', 'me', 'adm', 'zed']);
  });

  it('counts free seats with her included', () => {
    const others = Array.from({ length: 29 }, (_, i) => member(`u${i}`));
    expect(slotsLeft(meta(member('me', 'owner'), others))).toBe(2);
    expect(slotsLeft(meta(member('me', 'owner'), [...others, member('x'), member('y'), member('z')]))).toBe(0);
  });

  it('offers only friends who are not already in, sorted by name', () => {
    const m = meta(member('me', 'owner'), [member('ana'), member('bea', 'member', 'left')]);
    const friends = [
      { profile: { id: 'cat', display_name: 'Cat', username: 'cat' } },
      { profile: { id: 'ana', display_name: 'Ana', username: 'ana' } },
      { profile: { id: 'bea', display_name: 'Bea', username: 'bea' } },
    ];
    expect(addableFriends(friends, m).map((f) => f.id)).toEqual(['bea', 'cat']);
  });
});

describe('mute', () => {
  const now = Date.parse('2026-10-11T12:00:00Z');

  it('turns a choice into the timestamp mute_conversation stores', () => {
    expect(muteUntil('1h', now)).toBe('2026-10-11T13:00:00.000Z');
    expect(muteUntil('8h', now)).toBe('2026-10-11T20:00:00.000Z');
    expect(muteUntil('1w', now)).toBe('2026-10-18T12:00:00.000Z');
    expect(muteUntil('always', now)).toBe(MUTE_FOREVER);
  });

  it('reads back as muted or not', () => {
    expect(isMuted(null, now)).toBe(false);
    expect(isMuted('2026-10-11T11:00:00Z', now)).toBe(false);
    expect(isMuted('2026-10-11T13:00:00Z', now)).toBe(true);
  });

  it('says what she will hear', () => {
    expect(muteLabel(null, now)).toBe('Notifications on');
    expect(muteLabel(MUTE_FOREVER, now)).toBe('Muted');
    expect(muteLabel('2026-10-11T13:00:00Z', now)).toMatch(/^Muted until /);
  });
});

it('names roles the way the list shows them', () => {
  expect(roleLabel('owner')).toBe('Owner');
  expect(roleLabel('admin')).toBe('Admin');
  expect(roleLabel('member')).toBe('');
});

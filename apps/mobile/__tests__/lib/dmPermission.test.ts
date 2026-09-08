import {
  DM_PERMISSIONS,
  dmPermissionLabel,
  dmPermissionDescription,
  nextDmPermission,
  readDmPermission,
} from '../../lib/dmPermission';

/**
 * "Who can message me" — three values, and none of them derived by elimination.
 *
 * This codebase has shipped the elimination bug twice: a `!== 'receipt'` branch
 * that counted purchase orders as revenue, and a badge that collapsed a `hybrid`
 * event into "in person". A three-value setting where the strictest option is
 * "everything that isn't Everyone" is the same shape, and the thing it would get
 * wrong is who is allowed to message a woman who asked to be left alone.
 */

describe('the permission set', () => {
  it('has exactly the three the prototype cycles through, in its order', () => {
    expect(DM_PERMISSIONS).toEqual(['friends', 'friends_of_friends', 'everyone']);
  });

  it('labels each one, without implying a mute this app does not have', () => {
    expect(dmPermissionLabel('friends')).toBe('Friends only');
    expect(dmPermissionLabel('friends_of_friends')).toBe('Friends of friends');
    expect(dmPermissionLabel('everyone')).toBe('Everyone — requests first');
  });

  it('describes what each one actually does to a stranger', () => {
    expect(dmPermissionDescription('everyone')).toMatch(/requests/i);
    expect(dmPermissionDescription('friends')).not.toMatch(/requests/i);
  });
});

describe('nextDmPermission', () => {
  it('cycles in the prototype order and wraps', () => {
    expect(nextDmPermission('friends')).toBe('friends_of_friends');
    expect(nextDmPermission('friends_of_friends')).toBe('everyone');
    expect(nextDmPermission('everyone')).toBe('friends');
  });

  it('starts from the default when the stored value is one we do not know', () => {
    // The column is unapplied on this branch, so the value can be absent. An
    // unknown value resolves to the default she is being shown — `everyone` —
    // and the tap moves her one step from there, which lands on the STRICTEST
    // option. A cycle that resolved an unknown value onto the permissive end
    // would quietly open her inbox on a tap meant to close it.
    expect(nextDmPermission(null)).toBe('friends');
    expect(nextDmPermission('nonsense' as never)).toBe('friends');
  });
});

describe('readDmPermission', () => {
  it('accepts each stored value', () => {
    for (const value of DM_PERMISSIONS) {
      expect(readDmPermission({ dm_permission: value })).toBe(value);
    }
  });

  it('falls back to everyone when the column is not there yet', () => {
    // Migration 093 is written and not applied. Until a human runs it the
    // profile row has no such key, and the app must behave exactly as it does
    // today — which is that anyone may message and the inbox files strangers
    // under Requests.
    expect(readDmPermission({})).toBe('everyone');
    expect(readDmPermission(null)).toBe('everyone');
  });

  it('refuses a value outside the set rather than trusting it', () => {
    expect(readDmPermission({ dm_permission: 'nobody' })).toBe('everyone');
  });
});

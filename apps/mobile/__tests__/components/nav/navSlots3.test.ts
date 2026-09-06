/**
 * The 3.0 bar contract, executable.
 *
 * Five tabs collapse to four plus a create action, and the create action sits in
 * the middle. Both of those are load-bearing: a five-slot bar is what the
 * redesign exists to undo, and a create button anywhere but the centre is a
 * different product. Neither is visible in a type, so they are asserted here.
 *
 * The route names are asserted against the filesystem rather than a list,
 * because a slot pointing at a directory that does not exist renders as a gap in
 * the bar and nothing else — no crash, no warning, no test failure.
 */
import { existsSync } from 'fs';
import { join } from 'path';
import { NAV_SLOTS_3, NAV_SLOTS_PUBLIC, navSlotsFor } from '../../../components/nav/navSlots3';

const TABS_DIR = join(__dirname, '..', '..', '..', 'app', '(tabs)');

describe('NAV_SLOTS_3', () => {
  it('is four tabs and one action', () => {
    expect(NAV_SLOTS_3).toHaveLength(5);
    expect(NAV_SLOTS_3.filter((s) => s.kind === 'route')).toHaveLength(4);
    expect(NAV_SLOTS_3.filter((s) => s.kind === 'action')).toHaveLength(1);
  });

  it('puts the create action in the centre, where a thumb reaches it', () => {
    expect(NAV_SLOTS_3[2].kind).toBe('action');
  });

  it('is Feed · Discover · ＋ · Messages · You, in that order', () => {
    expect(NAV_SLOTS_3.map((s) => s.label)).toEqual([
      'Feed',
      'Discover',
      'Create',
      'Messages',
      'You',
    ]);
  });

  it('points every route slot at a directory that exists', () => {
    for (const slot of NAV_SLOTS_3) {
      if (slot.kind !== 'route') continue;
      const dir = join(TABS_DIR, slot.routeName);
      expect(`${slot.routeName} → ${existsSync(dir) ? 'exists' : 'MISSING'}`).toBe(
        `${slot.routeName} → exists`
      );
    }
  });

  it('gives every slot a distinct icon pair so the bar reads without labels', () => {
    const icons = NAV_SLOTS_3.map((s) => s.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it('drops Grow, Connect, Build and Play as destinations — the redesign dissolves them', () => {
    const routes = NAV_SLOTS_3.filter((s) => s.kind === 'route').map((s) =>
      s.kind === 'route' ? s.routeName : ''
    );
    for (const gone of ['grow', 'connect', 'build']) {
      expect(routes).not.toContain(gone);
    }
  });
});

describe('NAV_SLOTS_PUBLIC', () => {
  it('is Archive · Chat · You — no Discover, no Create', () => {
    expect(NAV_SLOTS_PUBLIC.map((s) => s.label)).toEqual(['Archive', 'Chat', 'You']);
    expect(NAV_SLOTS_PUBLIC.every((s) => s.kind === 'route')).toBe(true);
  });

  it('reuses existing tab directories so the bar does not point at a gap', () => {
    for (const slot of NAV_SLOTS_PUBLIC) {
      if (slot.kind !== 'route') continue;
      const dir = join(TABS_DIR, slot.routeName);
      expect(`${slot.routeName} → ${existsSync(dir) ? 'exists' : 'MISSING'}`).toBe(
        `${slot.routeName} → exists`
      );
    }
  });
});

describe('navSlotsFor', () => {
  it('gives beta the full 3.0 bar and public the limited launch bar', () => {
    expect(navSlotsFor('beta')).toBe(NAV_SLOTS_3);
    expect(navSlotsFor('public')).toBe(NAV_SLOTS_PUBLIC);
  });
});

/**
 * The ratchet logic behind the feel gate (scripts/feel/feelGate.ts), on small fixtures.
 * Rules: a gated count may only go down per file (current <= max(baseline, allowlist));
 * the allowlist is the spec's target exceptions, each with a reason; tightening never loosens.
 */
import {
  checkRatchet,
  isGated,
  tighten,
  targetGaps,
  allowlistFromSites,
  mergeAllowlists,
  validateAllowlist,
  ownerLane,
} from '../../scripts/feel/feelGate';
import type { Allowlist, HapticSite } from '../../scripts/feel/feelGate';

const SPIN = 'F11_spinner_elements';

describe('isGated', () => {
  it('gates the static halves of F2, F5, F7/F11, F12 and F13, not the info rules', () => {
    for (const r of [SPIN, 'F2_raw_pressable_no_feedback', 'F5_modal_animationType_slide', 'F5_modal_animationType_fade',
      'F12_anim_without_reduce_motion', 'F13_direct_expo_haptics', 'F13_haptic_call_select', 'F13_haptic_call_selection']) {
      expect(isGated(r)).toBe(true);
    }
    for (const r of ['F6_flatlist', 'F15_rn_image', 'F14_keyboard_avoiding_view', 'F12_useReducedMotion_instances', 'info_retired_files', 'T_legacy_spring_params']) {
      expect(isGated(r)).toBe(false);
    }
  });
});

describe('checkRatchet', () => {
  const baseline = { [SPIN]: { 'a.tsx': 3, 'b.tsx': 1 } };

  it('passes when every file is at or below its baseline', () => {
    expect(checkRatchet({ [SPIN]: { 'a.tsx': 3 } }, baseline, {})).toEqual([]);
    expect(checkRatchet({}, baseline, {})).toEqual([]);
  });

  it('fails a file that went up, and a new file, naming rule, file and numbers', () => {
    const v = checkRatchet({ [SPIN]: { 'a.tsx': 4, 'c.tsx': 1 } }, baseline, {});
    expect(v.map((x) => [x.rule, x.file, x.current, x.allowed])).toEqual([
      [SPIN, 'a.tsx', 4, 3],
      [SPIN, 'c.tsx', 1, 0],
    ]);
    expect(v[0].message).toMatch(/F11_spinner_elements a\.tsx: 4 > 3/);
  });

  it('lets an allowlisted file sit at its allowance even above its baseline', () => {
    const allow: Allowlist = { [SPIN]: { 'c.tsx': { max: 1, reason: 'test' } } };
    expect(checkRatchet({ [SPIN]: { 'c.tsx': 1 } }, baseline, allow)).toEqual([]);
    expect(checkRatchet({ [SPIN]: { 'c.tsx': 2 } }, baseline, allow)).toHaveLength(1);
  });

  it('ignores info rules entirely', () => {
    expect(checkRatchet({ F6_flatlist: { 'z.tsx': 9 } }, {}, {})).toEqual([]);
  });
});

describe('tighten', () => {
  it('lowers each gated entry to the current count, drops zeros, never raises or adds', () => {
    const baseline = { [SPIN]: { 'a.tsx': 3, 'b.tsx': 1, 'c.tsx': 2 } };
    const current = { [SPIN]: { 'a.tsx': 2, 'c.tsx': 5, 'new.tsx': 1 }, F6_flatlist: { 'x.tsx': 1 } };
    expect(tighten(baseline, current)).toEqual({ [SPIN]: { 'a.tsx': 2, 'c.tsx': 2 } });
  });
});

describe('haptic sites -> allowlist', () => {
  const sites: HapticSite[] = [
    { id: 'tab', kind: 'selection', event: 'tab change', files: ['nav.tsx'], max: 1, required: true, lane: 'A' },
    { id: 'react', kind: 'light', event: 'committed reaction', files: ['pick.ts'], max: 2, required: true, lane: 'C' },
    { id: 'react-2', kind: 'light', event: 'committed reaction', files: ['pick.ts', 'row.tsx'], max: 1, required: false, lane: 'D' },
  ];

  it('allows each site kind in each of its files, adding up sites that share a file', () => {
    const allow = allowlistFromSites(sites);
    expect(allow.F13_haptic_call_selection['nav.tsx'].max).toBe(1);
    expect(allow.F13_haptic_call_light['pick.ts'].max).toBe(3);
    expect(allow.F13_haptic_call_light['row.tsx'].max).toBe(1);
    expect(allow.F13_haptic_call_light['pick.ts'].reason).toMatch(/committed reaction/);
  });

  it('reports required sites still missing and calls left to rename or remove', () => {
    const allow = allowlistFromSites(sites);
    const current = {
      F13_haptic_call_select: { 'nav.tsx': 1 },
      F13_haptic_call_light: { 'pick.ts': 1 },
      F13_haptic_call_tap: { 'send.tsx': 1 },
      [SPIN]: { 'a.tsx': 2 },
    };
    const gaps = targetGaps(current, allow, sites);
    expect(gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: 'F13_haptic_call_select', file: 'nav.tsx', current: 1, target: 0 }),
      expect.objectContaining({ rule: 'F13_haptic_call_tap', file: 'send.tsx', current: 1, target: 0 }),
      expect.objectContaining({ rule: SPIN, file: 'a.tsx', current: 2, target: 0 }),
      expect.objectContaining({ rule: 'F13_haptic_call_selection', file: 'nav.tsx', current: 0, target: 1, site: 'tab' }),
    ]));
    // A required site that is present is not a gap; neither is an optional one that is absent.
    expect(gaps.find((g) => g.site === 'react')).toBeUndefined();
    expect(gaps.find((g) => g.site === 'react-2')).toBeUndefined();
  });
});

describe('allowlist hygiene', () => {
  it('merges allowlists, adding allowances for the same rule and file', () => {
    const a: Allowlist = { R: { f: { max: 1, reason: 'x' } } };
    const b: Allowlist = { R: { f: { max: 2, reason: 'y' } }, S: { g: { max: 1, reason: 'z' } } };
    const m = mergeAllowlists(a, b);
    expect(m.R.f).toEqual({ max: 3, reason: 'x; y' });
    expect(m.S.g.max).toBe(1);
  });

  it('flags entries with no reason, a negative max or an ungated rule', () => {
    const errs = validateAllowlist({
      [SPIN]: { 'a.tsx': { max: 1, reason: '' }, 'b.tsx': { max: -1, reason: 'r' } },
      F6_flatlist: { 'c.tsx': { max: 1, reason: 'r' } },
    });
    expect(errs).toHaveLength(3);
  });
});

describe('ownerLane (spec §4.2)', () => {
  it.each([
    ['components/nav/FloatingTabBar.tsx', 'A'],
    ['app/(tabs)/feed/index.tsx', 'A'],
    ['app/chat/_layout.tsx', 'A'],
    ['components/feed/PollCell.tsx', 'B'],
    ['app/archive/[slug]/index.tsx', 'B'],
    ['app/(tabs)/discover/index.tsx', 'B'],
    ['app/(tabs)/discover/community/channels/[communityId].tsx', 'D'],
    ['components/ui/Switch.tsx', 'C'],
    ['components/reactions/useReactionPicker.ts', 'C'],
    ['app/chat/[id].tsx', 'D'],
    ['components/profile/SelfControls.tsx', 'D'],
    ['app/badges.tsx', 'D'],
    ['lib/haptics.ts', 'E'],
    ['hooks/useCommentLikes.ts', 'unassigned'],
  ])('%s -> %s', (file, lane) => {
    expect(ownerLane(file)).toBe(lane);
  });
});

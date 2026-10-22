/**
 * THE FEEL GATE (polish/motion-spec.md §2: static halves of F2, F5, F7/F11, F12, F13; §3.3).
 *
 * Scans apps/mobile with the ported feel scanner and holds every gated count to a ratchet:
 * per rule and file, the count may only go down from `scripts/feel/feel-baseline.json`
 * (main 50b1f5d), except where `scripts/feel/feelGateConfig.ts` allows it with a reason.
 * Owner lanes (A, B, C, D) drive the counts to the spec's targets; this test only stops
 * regressions, so it is green today.
 *
 * Modes (env):
 *   FEEL_SCAN_REF=<git ref>   gate a branch without checking it out (e.g. polish/w3-b)
 *   FEEL_REPORT=<file.json>   write summary + per-file gaps to the spec targets
 *   FEEL_RATCHET_WRITE=1      lower the baseline to the current counts (never raises it);
 *                             run after merging a lane, commit the JSON
 */
import fs from 'fs';
import path from 'path';
import { readGitRef, readTree, scanSources, summarize } from '../../scripts/feel/feelStaticScan';
import type { Hits } from '../../scripts/feel/feelStaticScan';
import { checkRatchet, isGated, targetGaps, tighten, validateAllowlist } from '../../scripts/feel/feelGate';
import { ALLOWLIST, HAPTIC_SITES } from '../../scripts/feel/feelGateConfig';

const MOBILE = path.resolve(__dirname, '../..');
const REPO = path.resolve(MOBILE, '../..');
const BASELINE_FILE = path.join(MOBILE, 'scripts/feel/feel-baseline.json');

type BaselineFile = { comment: string; generatedFrom: string; rules: Hits };
const baselineFile = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) as BaselineFile;
const baseline = baselineFile.rules;

const ref = process.env.FEEL_SCAN_REF;
const current = scanSources(ref ? readGitRef(REPO, ref) : readTree(MOBILE));
const violations = checkRatchet(current, baseline, ALLOWLIST);

const FAMILIES: [string, RegExp][] = [
  ['F7/F11 spinners', /^F11_spinner_elements$/],
  ['F2 raw pressables with no press feedback', /^F2_raw_pressable_no_feedback$/],
  ['F5 system slide sheets', /^F5_modal_animationType_slide$/],
  ['F5 fading sheets', /^F5_modal_animationType_fade$/],
  ['F12 animations that ignore Reduce Motion', /^F12_anim_without_reduce_motion$/],
  ['F13 direct expo-haptics imports', /^F13_direct_expo_haptics$/],
  ['F13 haptic call sites (§3.3 table)', /^F13_haptic_call_/],
];

afterAll(() => {
  if (process.env.FEEL_REPORT) {
    const gaps = targetGaps(current, ALLOWLIST, HAPTIC_SITES);
    fs.writeFileSync(process.env.FEEL_REPORT, JSON.stringify({
      ref: ref ?? 'working tree',
      summary: summarize(current),
      violations,
      gaps,
    }, null, 2));
  }
  if (process.env.FEEL_RATCHET_WRITE === '1' && violations.length === 0) {
    const next: BaselineFile = { ...baselineFile, rules: tighten(baseline, current) };
    fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(next, null, 2)}\n`);
  }
});

describe('feel gate: the allowlist and baseline are sound', () => {
  it('every allowlist entry is for a gated rule and carries a reason', () => {
    expect(validateAllowlist(ALLOWLIST)).toEqual([]);
  });

  it('the baseline only holds gated rules with positive counts', () => {
    for (const [rule, byFile] of Object.entries(baseline)) {
      expect(isGated(rule)).toBe(true);
      for (const n of Object.values(byFile)) expect(n).toBeGreaterThan(0);
    }
  });

  it('the scan sees the app (not an empty tree)', () => {
    expect(Object.keys(current.F11_spinner_elements ?? {}).length + Object.keys(current.F13_haptic_call_selection ?? {}).length
      + Object.keys(current.F13_haptic_call_select ?? {}).length).toBeGreaterThan(0);
  });
});

describe('feel gate: counts may only go down (ratchet vs main 50b1f5d)', () => {
  it.each(FAMILIES)('%s', (_name, re) => {
    const mine = violations.filter((v) => re.test(v.rule)).map((v) => v.message);
    expect(mine).toEqual([]);
  });
});

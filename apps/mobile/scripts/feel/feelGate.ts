/**
 * The feel gate's ratchet (polish/motion-spec.md §2 static halves of F2, F5, F7/F11, F12, F13;
 * lane E). `__tests__/feel/feelGate.test.ts` scans apps/mobile and checks it against
 * `feel-baseline.json` with the allowlist in `feelGateConfig.ts`.
 *
 *   gate (CI, must pass):  per gated rule and file, current <= max(baseline, allowlist max).
 *                          Counts may only go down; a new file starts at 0.
 *   target (the spec):     per gated rule and file, current <= allowlist max (0 if unlisted),
 *                          and every required §3.3 haptic site exists. Owner lanes drive the
 *                          gaps to zero; `targetGaps` lists them.
 *   tighten:               the baseline drops to the current counts (never rises), so a fixed
 *                          file cannot regress. Run with FEEL_RATCHET_WRITE=1 after a merge.
 */
import type { Hits } from './feelStaticScan';

export interface AllowEntry {
  /** How many hits this file may keep for good (the spec's target exception). */
  max: number;
  /** Why: required for every entry. */
  reason: string;
}
/** rule -> file -> entry */
export type Allowlist = Record<string, Record<string, AllowEntry>>;

export type HapticKind = 'selection' | 'light' | 'medium' | 'success';

/** One row of the §3.3 haptic map, placed in the files where its call may live. */
export interface HapticSite {
  id: string;
  kind: HapticKind;
  /** The §3.3 "fires on" event. */
  event: string;
  /** Candidate files (relative to apps/mobile); the call may live in any of them. */
  files: string[];
  /** Call sites of `kind` this site allows in each of its files. */
  max: number;
  /** Target: the site must exist (at least one call of `kind` across its files). */
  required: boolean;
  /** Owning lane (§4.2). */
  lane: string;
}

export interface Violation {
  rule: string;
  file: string;
  current: number;
  allowed: number;
  baseline: number;
  message: string;
}

export interface Gap {
  rule: string;
  file: string;
  current: number;
  target: number;
  lane: string;
  action: 'remove' | 'rename' | 'add';
  site?: string;
}

const GATED = [
  /^F11_spinner_elements$/,
  /^F2_raw_pressable_no_feedback$/,
  /^F5_modal_animationType_(slide|fade)$/,
  /^F12_anim_without_reduce_motion$/,
  /^F13_direct_expo_haptics$/,
  /^F13_haptic_call_\w+$/,
];

export function isGated(rule: string): boolean {
  return GATED.some((re) => re.test(rule));
}

const SPEC_KINDS = new Set<string>(['selection', 'light', 'medium', 'success']);
/** Wave 1/2 haptic names and the §3.3 kind they stand for (undefined: no kind). */
const LEGACY_KIND: Record<string, HapticKind | undefined> = {
  select: 'selection',
  tap: 'light',
  tapLight: 'light',
  celebrate: 'success',
  warning: undefined,
  default: 'light',
  dynamic: undefined,
};

const HINTS: Record<string, string> = {
  F11_spinner_elements: 'no new <ActivityIndicator>: use Skeleton (lists) or RoxyLoading (single waits) — spec F7/F11',
  F2_raw_pressable_no_feedback: 'every pressable answers: PressableScale, or a `pressed` style — spec F2 (scrim backdrops go in the allowlist with a reason)',
  F5_modal_animationType_slide: 'no system slide sheets: use components/feedback/Sheet — spec F5',
  F5_modal_animationType_fade: 'never fade a sheet: use components/feedback/Sheet (only the scrim fades) — spec F5',
  F12_anim_without_reduce_motion: 'every animation honours Reduce Motion (useReducedMotion / ReduceMotion) — spec F12',
  F13_direct_expo_haptics: 'haptics only through lib/haptics — spec F13 §3.3',
};

function hintFor(rule: string): string {
  if (HINTS[rule]) return HINTS[rule];
  if (rule.startsWith('F13_haptic_call_')) {
    return 'haptics fire only on the §3.3 events, through haptic(<selection|light|medium|success>); a new site needs a HAPTIC_SITES entry (lane E) — spec F13';
  }
  return '';
}

/** Gate: every gated (rule, file) at or below max(baseline, allowlist). */
export function checkRatchet(current: Hits, baseline: Hits, allow: Allowlist): Violation[] {
  const out: Violation[] = [];
  for (const rule of Object.keys(current).filter(isGated).sort()) {
    for (const file of Object.keys(current[rule]).sort()) {
      const n = current[rule][file];
      const base = baseline[rule]?.[file] ?? 0;
      const allowed = Math.max(base, allow[rule]?.[file]?.max ?? 0);
      if (n > allowed) {
        out.push({
          rule,
          file,
          current: n,
          allowed,
          baseline: base,
          message: `${rule} ${file}: ${n} > ${allowed} (baseline ${base}). ${hintFor(rule)}`,
        });
      }
    }
  }
  return out;
}

/** The baseline lowered to the current counts: never raised, never extended, zeros dropped. */
export function tighten(baseline: Hits, current: Hits): Hits {
  const out: Hits = {};
  for (const rule of Object.keys(baseline).filter(isGated).sort()) {
    for (const file of Object.keys(baseline[rule]).sort()) {
      const n = Math.min(baseline[rule][file], current[rule]?.[file] ?? 0);
      if (n > 0) (out[rule] ||= {})[file] = n;
    }
  }
  return out;
}

/** The §3.3 sites as F13_haptic_call_<kind> allowances (sites sharing a file add up). */
export function allowlistFromSites(sites: HapticSite[]): Allowlist {
  const out: Allowlist = {};
  for (const s of sites) {
    const rule = `F13_haptic_call_${s.kind}`;
    for (const file of s.files) {
      const byFile = (out[rule] ||= {});
      const prev = byFile[file];
      const reason = `§3.3 ${s.kind}: ${s.event} (site ${s.id}, lane ${s.lane})`;
      byFile[file] = prev ? { max: prev.max + s.max, reason: `${prev.reason}; ${reason}` } : { max: s.max, reason };
    }
  }
  return out;
}

export function mergeAllowlists(...lists: Allowlist[]): Allowlist {
  const out: Allowlist = {};
  for (const list of lists) {
    for (const [rule, byFile] of Object.entries(list)) {
      for (const [file, e] of Object.entries(byFile)) {
        const tgt = (out[rule] ||= {});
        const prev = tgt[file];
        tgt[file] = prev ? { max: prev.max + e.max, reason: `${prev.reason}; ${e.reason}` } : { ...e };
      }
    }
  }
  return out;
}

/** Problems in an allowlist: missing reasons, negative allowances, entries for ungated rules. */
export function validateAllowlist(allow: Allowlist): string[] {
  const errs: string[] = [];
  for (const [rule, byFile] of Object.entries(allow)) {
    for (const [file, e] of Object.entries(byFile)) {
      if (!isGated(rule)) errs.push(`${rule} ${file}: not a gated rule`);
      else if (!e.reason || !e.reason.trim()) errs.push(`${rule} ${file}: no reason`);
      else if (!(e.max >= 0)) errs.push(`${rule} ${file}: max ${e.max}`);
    }
  }
  return errs;
}

/** What stands between the code and the spec's targets, per file, for the owner lanes. */
export function targetGaps(current: Hits, allow: Allowlist, sites: HapticSite[]): Gap[] {
  const gaps: Gap[] = [];
  for (const rule of Object.keys(current).filter(isGated).sort()) {
    for (const file of Object.keys(current[rule]).sort()) {
      const n = current[rule][file];
      const target = allow[rule]?.[file]?.max ?? 0;
      if (n <= target) continue;
      let action: Gap['action'] = 'remove';
      const label = rule.replace(/^F13_haptic_call_/, '');
      if (rule.startsWith('F13_haptic_call_') && !SPEC_KINDS.has(label)) {
        const kind = LEGACY_KIND[label];
        if (kind && (allow[`F13_haptic_call_${kind}`]?.[file]?.max ?? 0) > 0) action = 'rename';
      }
      gaps.push({ rule, file, current: n, target, lane: ownerLane(file), action });
    }
  }
  for (const s of sites.filter((x) => x.required)) {
    const rule = `F13_haptic_call_${s.kind}`;
    const have = s.files.reduce((sum, f) => sum + (current[rule]?.[f] ?? 0), 0);
    if (have < 1) gaps.push({ rule, file: s.files.join(' | '), current: 0, target: 1, lane: s.lane, action: 'add', site: s.id });
  }
  return gaps;
}

/**
 * The lane that owns a file (polish/motion-spec.md §4.2), for the gap report.
 * 'unassigned' = §4.2 names no owner (the orchestrator assigns it).
 */
export function ownerLane(file: string): string {
  const f = file;
  if (f === 'lib/haptics.ts' || f.startsWith('modules/roxy-haptics/') || f.startsWith('scripts/feel/')) return 'E';
  if (/^app\/(.*\/)?_layout\.tsx$/.test(f) || f.startsWith('components/nav/') || f === 'app/(tabs)/feed/index.tsx' || f.startsWith('components/motion/')) return 'A';
  if (f.startsWith('components/ui/') || f === 'lib/motion.ts' || f === 'hooks/useReducedMotion.ts' || f.startsWith('components/reactions/')
    || f.startsWith('components/roxy/') || f === 'app/roxy-chat.tsx' || f.startsWith('components/feedback/')) return 'C';
  if (f.startsWith('app/(tabs)/discover/community/channels/')) return 'D';
  if (f.startsWith('components/feed/') || f.startsWith('components/discover/') || f.startsWith('components/archive/')
    || f.startsWith('app/(tabs)/discover/') || f.startsWith('app/archive/') || ['app/search.tsx', 'app/people.tsx', 'app/notifications.tsx',
    'store/feedStore.ts', 'store/archiveStore.ts', 'lib/announcements.ts', 'lib/imageLoading.ts', 'lib/cacheFirst.ts'].includes(f)) return 'B';
  if (f.startsWith('app/') || f.startsWith('store/')
    || /^components\/(messages|chat|channels|profile|events|grow|build|safety|account|donations|gamification|community)\//.test(f)) return 'D';
  return 'unassigned';
}

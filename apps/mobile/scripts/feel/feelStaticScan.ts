/**
 * Roxy Wave 3 "Feel" static scanner — the CI port of the Phase A scanner
 * (D:/Temp/roxy-polish/wave3/motion/feel-static-scan.cjs; polish/motion-spec.md §2 budgets and
 * the Appendix baseline). Each rule maps to a budget F-id. Pure functions over source text, so
 * jest can run it (`__tests__/feel/feelGate.test.ts`) on the working tree or on any git ref.
 *
 * Differences from the Phase A scanner, on purpose:
 *   - Rules read code with comments blanked out (`stripComments`), because the repo retires code
 *     by commenting it out: a commented-out spinner or haptic must stop counting, and a comment
 *     that merely mentions `PressableScale` or "reduced motion" must not exempt a file.
 *   - F13 haptic calls: `lib/haptics.ts` (the definitions) is not a call site, a method call like
 *     `useCelebrationStore.getState().celebrate(...)` is not a haptic, and a call whose kind is
 *     not one string literal (`haptic(accept ? 'success' : 'tap')`) counts as `dynamic`.
 * `info_retired_files` still reads the raw text (its markers live in comments).
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

/** rule -> file (relative to apps/mobile, posix) -> count */
export type Hits = Record<string, Record<string, number>>;

/** The directories the Phase A scanner read (relative to apps/mobile). */
export const SCAN_DIRS = ['app', 'components', 'lib', 'hooks', 'store'] as const;

export function isSourceFile(rel: string): boolean {
  return /\.(tsx?|jsx?)$/.test(rel) && !/__tests__|\.test\./.test(rel);
}

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (file.endsWith('.js')) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/**
 * The source with every comment (line, block, JSX `{/* *\/}`) replaced by spaces; newlines stay,
 * so offsets and line numbers still match the file. Strings, templates and JSX text are kept.
 */
export function stripComments(file: string, src: string): string {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, false, scriptKind(file));
  const ranges = new Map<number, number>();
  const collect = (rs: ts.CommentRange[] | undefined) => {
    for (const r of rs ?? []) ranges.set(r.pos, r.end);
  };
  const visit = (node: ts.Node): void => {
    // JSX text is content, not trivia: "a // b" inside <Text> is not a comment.
    if (node.kind !== ts.SyntaxKind.JsxText) {
      collect(ts.getLeadingCommentRanges(src, node.pos));
      collect(ts.getTrailingCommentRanges(src, node.pos));
    }
    for (const child of node.getChildren(sf)) visit(child);
  };
  visit(sf);
  if (ranges.size === 0) return src;
  const chars = src.split('');
  for (const [pos, end] of ranges) {
    for (let i = pos; i < end; i++) if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
  }
  return chars.join('');
}

const HAPTIC_CALL = /(?<![\w.$])(?<!function\s+)(haptic|tapLight|celebrate)\s*\(/g;

/**
 * F13: one label per haptic call site in `file`, in source order. `haptic('x')` -> 'x';
 * `haptic()` -> 'default'; `haptic(<expression>)` -> 'dynamic'; `tapLight(` / `celebrate(` ->
 * their own names. `lib/haptics.ts` defines them and has no call sites.
 */
export function haptCallLabels(file: string, src: string, code = stripComments(file, src)): string[] {
  if (/(^|\/)lib\/haptics\.ts$/.test(file)) return [];
  const labels: string[] = [];
  for (const m of code.matchAll(HAPTIC_CALL)) {
    if (m[1] !== 'haptic') {
      labels.push(m[1]);
      continue;
    }
    const rest = code.slice((m.index ?? 0) + m[0].length);
    const lit = /^\s*'(\w+)'\s*[,)]/.exec(rest) ?? /^\s*"(\w+)"\s*[,)]/.exec(rest);
    if (lit) labels.push(lit[1]);
    else if (/^\s*\)/.test(rest)) labels.push('default');
    else labels.push('dynamic');
  }
  return labels;
}

/** Runs every rule on one file and adds its hits. `file` is relative to apps/mobile. */
function scanFile(file: string, raw: string, add: (rule: string, n?: number) => void): void {
  const s = stripComments(file, raw);
  const retired = /RETIRED|SUPERSEDED/.test(raw) && /not rendered|Kept exported/.test(raw);
  // F7/F11: spinners used as a loading state.
  const spin = (s.match(/<ActivityIndicator\b/g) || []).length;
  if (spin) add('F11_spinner_elements', spin);
  // F2: raw RN Pressable with no pressed feedback anywhere in the file (backdrops included;
  // the allowlist in feelGateConfig.ts carries the triaged scrim backdrops).
  if (/import\s*\{[^}]*\bPressable\b[^}]*\}\s*from\s*'react-native'/s.test(s)) {
    const n = (s.match(/<Pressable\b/g) || []).length;
    if (n && !/pressed|PressableScale|onPressIn/.test(s)) add('F2_raw_pressable_no_feedback', n);
  }
  // F5: system modal animations (not springs, not interruptible; "fade" fades the sheet).
  for (const m of s.matchAll(/animationType="(slide|fade)"/g)) add(`F5_modal_animationType_${m[1]}`);
  // F12: animations in a file that never consults reduced motion.
  const anims = (s.match(/Animated\.(spring|timing|loop|decay)\(|withSpring\(|withTiming\(|withRepeat\(/g) || []).length;
  if (anims && !/reducedMotion|useReducedMotion|reduced\b/.test(s) && !/(^|\/)lib\/motion\.ts$/.test(file)) {
    add('F12_anim_without_reduce_motion', anims);
  }
  // F1/F16: JS-thread-driven animations (legacy Animated with useNativeDriver false).
  const jsDriven = (s.match(/useNativeDriver:\s*false|animatedSpring\('\w+',\s*false\)|runSpring\([^)]*,\s*false\)/g) || []).length;
  if (jsDriven) add('F1_js_driver_animations', jsDriven);
  // Tokens: legacy tension/friction springs instead of SPRING.
  const legacy = (s.match(/tension:\s*\d+|friction:\s*\d+/g) || []).length;
  if (legacy && !/(^|\/)lib\/motion\.ts$/.test(file)) add('T_legacy_spring_params', legacy);
  // F13: haptics outside lib/haptics.ts, and the haptic call-site table.
  if (/from 'expo-haptics'/.test(s) && !/(^|\/)lib\/haptics\.ts$/.test(file)) add('F13_direct_expo_haptics');
  for (const label of haptCallLabels(file, raw, s)) add(`F13_haptic_call_${label}`);
  // F15: expo-image without a transition; RN Image.
  if (/from 'expo-image'/.test(s)) {
    const imgs = (s.match(/<Image\b/g) || []).length;
    if (imgs && !/transition=/.test(s)) add('F15_expo_image_no_transition', imgs);
  }
  if (/import\s*\{[^}]*\bImage\b[^}]*\}\s*from\s*'react-native'/s.test(s)) add('F15_rn_image');
  // F14: keyboard handled by KeyboardAvoidingView only (jumps on Android adjustResize).
  if (/<KeyboardAvoidingView\b/.test(s)) add('F14_keyboard_avoiding_view');
  // F6: plain FlatList lists.
  if (/<FlatList\b/.test(s)) add('F6_flatlist');
  // F7: pull-to-refresh sites (a no-op on web: react-native-web's RefreshControl is a View).
  if (/RefreshControl|onRefresh=\{/.test(s) && /\.tsx$/.test(file)) add('F7_pull_to_refresh_site');
  // F12: per-instance reduce-motion subscriptions.
  if (/useReducedMotion\(\)/.test(s)) add('F12_useReducedMotion_instances');
  if (retired) add('info_retired_files');
}

/** Scans `{ file: source }` (files relative to apps/mobile, posix separators). */
export function scanSources(src: Record<string, string>): Hits {
  const hits: Hits = {};
  for (const [file, raw] of Object.entries(src)) {
    scanFile(file, raw, (rule, n = 1) => {
      const byFile = (hits[rule] ||= {});
      byFile[file] = (byFile[file] || 0) + n;
    });
  }
  return hits;
}

/** rule -> { files, count } */
export function summarize(hits: Hits): Record<string, { files: number; count: number }> {
  const out: Record<string, { files: number; count: number }> = {};
  for (const [rule, byFile] of Object.entries(hits)) {
    out[rule] = { files: Object.keys(byFile).length, count: Object.values(byFile).reduce((a, b) => a + b, 0) };
  }
  return out;
}

/** The working tree under `mobileRoot` (apps/mobile), keyed by posix paths relative to it. */
export function readTree(mobileRoot: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules') walk(abs);
        continue;
      }
      const rel = path.relative(mobileRoot, abs).split(path.sep).join('/');
      if (isSourceFile(rel)) out[rel] = fs.readFileSync(abs, 'utf8');
    }
  };
  for (const d of SCAN_DIRS) {
    const abs = path.join(mobileRoot, d);
    if (fs.existsSync(abs)) walk(abs);
  }
  return out;
}

/** The same files at a git ref (read through `git show`, the worktree is not touched). */
export function readGitRef(repoRoot: string, ref: string): Record<string, string> {
  const git = (args: string[]) => execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', maxBuffer: 64e6 });
  const files = git(['ls-tree', '-r', '--name-only', ref, '--', ...SCAN_DIRS.map((d) => `apps/mobile/${d}`)])
    .split('\n')
    .filter((f) => f && isSourceFile(f));
  const out: Record<string, string> = {};
  for (const f of files) out[f.replace(/^apps\/mobile\//, '')] = git(['show', `${ref}:${f}`]);
  return out;
}

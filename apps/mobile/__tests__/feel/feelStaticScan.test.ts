/**
 * Unit tests for the feel static scanner (scripts/feel/feelStaticScan.ts), the jest port of
 * D:/Temp/roxy-polish/wave3/motion/feel-static-scan.cjs (polish/motion-spec.md §2, Appendix).
 * Each rule is pinned on a small source string, then the tree reader on the real app.
 */
import path from 'path';
import { readTree, scanSources, stripComments, isSourceFile, haptCallLabels } from '../../scripts/feel/feelStaticScan';

const scan1 = (file: string, s: string) => scanSources({ [file]: s });
const count = (hits: ReturnType<typeof scanSources>, rule: string, file: string) => hits[rule]?.[file] ?? 0;

describe('stripComments', () => {
  it('blanks line, block and JSX comments and keeps code, strings and JSX text', () => {
    const src = [
      "const url = 'https://roxy.app/x'; // trailing <ActivityIndicator />",
      '/* <ActivityIndicator /> */',
      'const el = <View>{/* <ActivityIndicator /> */}<Text>a // b</Text></View>;',
      "haptic('select'); // haptic('tap')",
    ].join('\n');
    const out = stripComments('x.tsx', src);
    expect(out).toContain("'https://roxy.app/x'");
    expect(out).toContain('<Text>a // b</Text>');
    expect(out).toContain("haptic('select');");
    expect(out).not.toMatch(/ActivityIndicator/);
    expect(out).not.toContain("haptic('tap')");
    // Line structure is kept, so a reader can still map hits to lines.
    expect(out.split('\n')).toHaveLength(4);
  });
});

describe('F11 spinners (F7/F11)', () => {
  it('counts <ActivityIndicator> elements, not commented-out ones', () => {
    const h = scan1('components/a.tsx', '<ActivityIndicator />\n<ActivityIndicator size="small"/>\n{/* <ActivityIndicator /> */}');
    expect(count(h, 'F11_spinner_elements', 'components/a.tsx')).toBe(2);
  });
});

describe('F2 raw Pressable with no press feedback', () => {
  const raw = "import {\n  View,\n  Pressable,\n} from 'react-native';\nexport const A = () => <View><Pressable onPress={f} /><Pressable onPress={g} /></View>;";

  it('counts every <Pressable> in a file that imports RN Pressable and shows no feedback', () => {
    expect(count(scan1('components/a.tsx', raw), 'F2_raw_pressable_no_feedback', 'components/a.tsx')).toBe(2);
  });

  it.each([
    ['a pressed style', raw.replace('onPress={f}', 'style={({ pressed }) => [s.a, pressed && s.b]} onPress={f}')],
    ['PressableScale', raw + "\nimport { PressableScale } from '../ui/PressableScale';"],
    ['onPressIn', raw.replace('onPress={g}', 'onPressIn={h} onPress={g}')],
  ])('is clean with %s', (_label, s) => {
    expect(count(scan1('components/a.tsx', s), 'F2_raw_pressable_no_feedback', 'components/a.tsx')).toBe(0);
  });

  it('a comment that only mentions PressableScale does not exempt the file', () => {
    const s = raw + '\n// TODO: morph like PressableScale';
    expect(count(scan1('components/a.tsx', s), 'F2_raw_pressable_no_feedback', 'components/a.tsx')).toBe(2);
  });

  it('ignores <PressableScale> tags and files without the raw import', () => {
    const s = "import { PressableScale } from '../ui/PressableScale';\nconst a = <PressableScale />;";
    expect(scanSources({ 'components/a.tsx': s }).F2_raw_pressable_no_feedback).toBeUndefined();
  });
});

describe('F5 system modal animations', () => {
  it('counts animationType slide and fade separately', () => {
    const h = scan1('components/a.tsx', '<Modal animationType="slide" /><Modal animationType="fade" /><Modal animationType="slide" /><Modal animationType="none" />');
    expect(count(h, 'F5_modal_animationType_slide', 'components/a.tsx')).toBe(2);
    expect(count(h, 'F5_modal_animationType_fade', 'components/a.tsx')).toBe(1);
  });
});

describe('F12 animations that ignore Reduce Motion', () => {
  const anim = 'Animated.timing(v, { toValue: 1, useNativeDriver: true }).start();\nconst s = withSpring(1);';

  it('counts animation calls in a file that never reads reduced motion', () => {
    expect(count(scan1('components/a.tsx', anim), 'F12_anim_without_reduce_motion', 'components/a.tsx')).toBe(2);
  });

  it('is clean when the file consults reduced motion in code', () => {
    const s = `const reduced = useReducedMotion();\n${anim}`;
    expect(count(scan1('components/a.tsx', s), 'F12_anim_without_reduce_motion', 'components/a.tsx')).toBe(0);
    expect(count(scan1('components/a.tsx', s), 'F12_useReducedMotion_instances', 'components/a.tsx')).toBe(1);
  });

  it('a comment about reduced motion does not count as consulting it', () => {
    const s = `// TODO: honour reducedMotion\n${anim}`;
    expect(count(scan1('components/a.tsx', s), 'F12_anim_without_reduce_motion', 'components/a.tsx')).toBe(2);
  });

  it('exempts lib/motion.ts (the token file)', () => {
    expect(scan1('lib/motion.ts', anim).F12_anim_without_reduce_motion).toBeUndefined();
  });
});

describe('F13 haptics', () => {
  it('flags a direct expo-haptics import outside lib/haptics.ts', () => {
    const s = "import * as Haptics from 'expo-haptics';";
    expect(count(scan1('app/event/x.tsx', s), 'F13_direct_expo_haptics', 'app/event/x.tsx')).toBe(1);
    expect(scan1('lib/haptics.ts', s).F13_direct_expo_haptics).toBeUndefined();
  });

  it('labels each call site by its literal kind or legacy name', () => {
    const s = [
      "haptic('selection');",
      "haptic('select', false);",
      "haptic( 'tap' );",
      'tapLight(reducedMotion);',
      'celebrate();',
      "haptic(accept ? 'success' : 'tap');",
      'useCelebrationStore.getState().celebrate(result.newlyEarned);',
      "// haptic('warning');",
      "/* tapLight(); */",
    ].join('\n');
    expect(haptCallLabels('components/a.tsx', s)).toEqual(['selection', 'select', 'tap', 'tapLight', 'celebrate', 'dynamic']);
    const h = scan1('components/a.tsx', s);
    expect(count(h, 'F13_haptic_call_selection', 'components/a.tsx')).toBe(1);
    expect(count(h, 'F13_haptic_call_dynamic', 'components/a.tsx')).toBe(1);
    expect(h.F13_haptic_call_warning).toBeUndefined();
  });

  it('does not count the definitions in lib/haptics.ts', () => {
    const s = "export function haptic(kind) {}\nexport function tapLight() { haptic('light'); }\nexport function celebrate() { haptic('success'); }";
    expect(haptCallLabels('lib/haptics.ts', s)).toEqual([]);
    expect(haptCallLabels('components/b.ts', 'function haptic(kind) {}')).toEqual([]);
  });
});

describe('info rules (reported, not gated)', () => {
  it('ports the remaining checks of the Phase A scanner', () => {
    const s = [
      "import { Image, FlatList } from 'react-native';",
      '<FlatList refreshControl={<RefreshControl />} />',
      '<KeyboardAvoidingView />',
      'Animated.spring(v, { tension: 40, friction: 7, useNativeDriver: false });',
    ].join('\n');
    const h = scan1('components/a.tsx', s);
    for (const rule of ['F15_rn_image', 'F6_flatlist', 'F7_pull_to_refresh_site', 'F14_keyboard_avoiding_view', 'F1_js_driver_animations']) {
      expect(count(h, rule, 'components/a.tsx')).toBe(1);
    }
    expect(count(h, 'T_legacy_spring_params', 'components/a.tsx')).toBe(2);
    const img = scan1('components/b.tsx', "import { Image } from 'expo-image';\n<Image source={a} /><Image source={b} />");
    expect(count(img, 'F15_expo_image_no_transition', 'components/b.tsx')).toBe(2);
  });
});

describe('readTree', () => {
  const MOBILE = path.resolve(__dirname, '../..');
  const tree = readTree(MOBILE);

  it('reads app, components, lib, hooks and store, keyed by posix paths relative to apps/mobile', () => {
    expect(tree['lib/haptics.ts']).toContain('export function haptic');
    expect(Object.keys(tree).some((f) => f.startsWith('app/'))).toBe(true);
    expect(Object.keys(tree).some((f) => f.startsWith('components/'))).toBe(true);
    expect(Object.keys(tree).every((f) => !f.includes('\\'))).toBe(true);
  });

  it('skips tests and non-source files', () => {
    expect(isSourceFile('components/a.tsx')).toBe(true);
    expect(isSourceFile('components/__tests__/a.tsx')).toBe(false);
    expect(isSourceFile('lib/a.test.ts')).toBe(false);
    expect(isSourceFile('assets/a.png')).toBe(false);
    expect(Object.keys(tree).every(isSourceFile)).toBe(true);
  });
});

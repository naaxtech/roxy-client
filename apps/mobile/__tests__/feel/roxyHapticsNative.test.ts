/**
 * F13 native half, as far as jest can see it (polish/motion-spec.md §4.1, decision P4).
 *
 * No device runs here, so this pins the three things that would silently drop the Android
 * Touch-feedback path from an installer build:
 *   1. Expo autolinking finds `modules/roxy-haptics` for Android (and not for iOS, which keeps
 *      expo-haptics), with the Kotlin module class the JS asks for.
 *   2. The Kotlin handles every constant name the JS can send, maps each to the
 *      `HapticFeedbackConstants` field of the same name, and never passes a flag that ignores
 *      the system setting.
 *   3. Git and the EAS upload keep the native sources: the repo ignores every `android/`
 *      directory, so the module's gradle project lives in `android-native/`.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { androidHapticFor } from '../../lib/haptics';
import type { HapticKind } from '../../lib/haptics';

const MOBILE = path.resolve(__dirname, '../..');
const MODULE_DIR = path.join(MOBILE, 'modules/roxy-haptics');
const NATIVE_DIR = path.join(MODULE_DIR, 'android-native');
const KOTLIN = path.join(NATIVE_DIR, 'src/main/java/expo/modules/roxyhaptics/RoxyHapticsModule.kt');
const MODULE_CLASS = 'expo.modules.roxyhaptics.RoxyHapticsModule';

type Descriptor = { packageName: string; modules?: string[]; projects?: { name: string; sourceDir: string }[] };

async function autolinked(platform: 'android' | 'ios'): Promise<Descriptor[]> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const al = require('expo-modules-autolinking/build/autolinking') as {
    queryAutolinkingModulesFromProjectAsync(root: string, o: { platform: string }): Promise<Descriptor[]>;
  };
  return al.queryAutolinkingModulesFromProjectAsync(MOBILE, { platform });
}

describe('RoxyHaptics autolinking', () => {
  it('links the module on Android, from android-native/, with the Kotlin class', async () => {
    const mods = await autolinked('android');
    const mine = mods.find((m) => m.packageName === 'roxy-haptics');
    expect(mine).toBeDefined();
    expect(mine!.modules).toEqual([MODULE_CLASS]);
    expect(mine!.projects).toHaveLength(1);
    expect(path.resolve(mine!.projects![0].sourceDir)).toBe(path.resolve(fs.realpathSync(NATIVE_DIR)));
  }, 60_000);

  it('does not link on iOS (iOS keeps expo-haptics)', async () => {
    const mods = await autolinked('ios');
    expect(mods.find((m) => m.packageName === 'roxy-haptics')).toBeUndefined();
  }, 60_000);
});

describe('RoxyHaptics Kotlin <-> JS contract', () => {
  const src = fs.existsSync(KOTLIN) ? fs.readFileSync(KOTLIN, 'utf8') : '';
  // Code only: the doc comments name the flags this module must not use.
  const kt = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('registers under the name loadRoxyHaptics() asks for, with a perform() function', () => {
    expect(kt).toMatch(/Name\("RoxyHaptics"\)/);
    expect(kt).toMatch(/AsyncFunction\("perform"\)/);
    expect(kt).toMatch(/class RoxyHapticsModule\s*:\s*Module\(\)/);
    expect(kt).toMatch(/^package expo\.modules\.roxyhaptics\s*$/m);
  });

  it('maps every constant the JS can send to the HapticFeedbackConstants field of that name', () => {
    const kinds: (HapticKind | 'warning')[] = ['selection', 'light', 'medium', 'success', 'warning'];
    const sent = new Set<string>();
    for (const k of kinds) for (let api = 24; api <= 36; api++) sent.add(androidHapticFor(k, api));
    for (const name of sent) {
      expect(kt).toMatch(new RegExp(`"${name}"\\s*->[^\\n]*HapticFeedbackConstants\\.${name}\\b`));
    }
  });

  it('never ignores the Touch feedback setting', () => {
    expect(kt).not.toMatch(/FLAG_IGNORE_GLOBAL_SETTING|FLAG_IGNORE_VIEW_SETTING/);
    expect(kt).toMatch(/performHapticFeedback\(\s*\w+\s*\)/);
  });

  it('plays on the main thread', () => {
    expect(kt).toMatch(/\.runOnQueue\(Queues\.MAIN\)/);
  });

  it('expo-module.config.json declares Android only and points autolinking at android-native', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(MODULE_DIR, 'expo-module.config.json'), 'utf8'));
    expect(cfg.platforms).toEqual(['android']);
    expect(cfg.android.modules).toEqual([MODULE_CLASS]);
    expect(cfg.android.gradlePath).toBe('android-native/build.gradle');
  });
});

describe('RoxyHaptics sources survive git and the EAS upload', () => {
  const repoRoot = path.resolve(MOBILE, '../..');
  const files = [
    'apps/mobile/modules/roxy-haptics/android-native/build.gradle',
    'apps/mobile/modules/roxy-haptics/android-native/src/main/AndroidManifest.xml',
    'apps/mobile/modules/roxy-haptics/android-native/src/main/java/expo/modules/roxyhaptics/RoxyHapticsModule.kt',
    'apps/mobile/modules/roxy-haptics/expo-module.config.json',
    'apps/mobile/modules/roxy-haptics/index.ts',
  ];

  it.each(files)('%s exists and is ignored by neither .gitignore nor .easignore', (rel) => {
    expect(fs.existsSync(path.join(repoRoot, rel))).toBe(true);
    // `git check-ignore` exits 1 when nothing ignores the path. `.easignore` (which REPLACES
    // .gitignore for EAS) is checked by loading it as an extra exclude file.
    const ignored = (extra: string[]): boolean => {
      try {
        execFileSync('git', ['-C', repoRoot, ...extra, 'check-ignore', '--no-index', '-q', rel], { stdio: 'ignore' });
        return true;
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status === 1) return false;
        throw e;
      }
    };
    expect(ignored([])).toBe(false);
    expect(ignored(['-c', `core.excludesFile=${path.join(repoRoot, '.easignore')}`])).toBe(false);
  });
});

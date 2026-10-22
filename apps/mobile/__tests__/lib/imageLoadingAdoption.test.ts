import * as fs from 'fs';
import * as path from 'path';

/**
 * Budget F15, the static half (motion-spec: `F15_expo_image_no_transition`,
 * `F15_rn_image` → 0 in lane B's files). Every expo-image in the feed,
 * Discover, the Archive and search takes its fade and cache policy from
 * `lib/imageLoading` as explicit props, and nothing draws a picture with
 * React Native's `Image` (no fade, no cache policy, no recycling key).
 */
const ROOT = path.resolve(__dirname, '../..');
const OWNED_DIRS = ['components/feed', 'components/discover', 'components/archive', 'app/archive'];
const OWNED_FILES = ['app/search.tsx', 'app/people.tsx', 'app/notifications.tsx'];

function walk(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return walk(rel);
    return /\.tsx?$/.test(e.name) ? [rel] : [];
  });
}

function discoverAppFiles(): string[] {
  return walk('app/(tabs)/discover').filter((f) => !f.split(path.sep).join('/').includes('community/channels/'));
}

const FILES = [...OWNED_DIRS.flatMap(walk), ...OWNED_FILES.filter((f) => fs.existsSync(path.join(ROOT, f))), ...discoverAppFiles()];

/** The opening tag starting at `from` (`<Name ...>` or `<Name ... />`), braces respected. */
function openingTag(src: string, from: number): string {
  let depth = 0;
  for (let i = from + 1; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return src.slice(from, i + 1);
  }
  return src.slice(from);
}

function expoImageTags(src: string): string[] {
  const names = new Set<string>();
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'expo-image'/g)) {
    for (const part of m[1].split(',')) {
      const [orig, alias] = part.trim().split(/\s+as\s+/);
      if (orig === 'Image') names.add(alias ?? 'Image');
    }
  }
  const tags: string[] = [];
  for (const name of names) {
    const re = new RegExp(`<${name}\\b`, 'g');
    for (const m of src.matchAll(re)) tags.push(openingTag(src, m.index ?? 0));
  }
  return tags;
}

describe('image defaults are adopted in lane B files (F15 static)', () => {
  it('scans a real set of files', () => {
    expect(FILES.length).toBeGreaterThan(40);
  });

  it('every expo-image sets transition and cachePolicy explicitly', () => {
    const missing: string[] = [];
    for (const f of FILES) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      for (const tag of expoImageTags(src)) {
        if (!/\btransition=/.test(tag) || !/\bcachePolicy=/.test(tag)) {
          missing.push(`${f}: ${tag.replace(/\s+/g, ' ').slice(0, 80)}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('nothing draws a picture with React Native Image', () => {
    const rn = FILES.filter((f) => /import\s*\{[^}]*\bImage\b[^}]*\}\s*from\s*'react-native'/s
      .test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
    expect(rn).toEqual([]);
  });
});

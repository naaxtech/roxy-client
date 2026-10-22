/**
 * v2 (design direction › Bans; decisions 2026-10-21): no violet, indigo or
 * lilac anywhere in the app's colours — not in the palette, not as a literal
 * on a screen. This walks the source the way a reviewer would and fails on
 * any colour literal whose hue sits in the violet band (225°–300°: indigo through violet; saturation
 * above 15%), so a pasted `#8B5CF6` cannot slip back in.
 *
 * Comments are skipped (they may name a retired value). The one exemption is
 * a file another lane owns and is rewriting in Wave 2; it is listed by name so
 * the exemption is visible and has to be removed by hand.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const DIRS = ['app', 'components', 'lib', 'hooks', 'store'];

/**
 * Files exempt while another lane rewrote them. Empty since Wave 2's Roxy AI
 * lane rewrote `app/roxy-chat.tsx` on tokens (its violet chip gradient went
 * with the v0 chat chrome). Add a name here only with the lane that owns it.
 */
const WAVE2_EXEMPT = new Set<string>([]);

function walk(dir: string, out: string[]): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

function rgbOf(lit: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(lit);
  if (hex) {
    let x = hex[1];
    if (x.length === 3) x = x.replace(/./g, (c) => c + c);
    const n = parseInt(x, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(lit);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

export function isVioletLiteral(lit: string): boolean {
  const rgb = rgbOf(lit);
  if (!rgb) return false;
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return false;
  const l = (max + min) / 2;
  const s = d / (1 - Math.abs(2 * l - 1));
  const h6 = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const h = (h6 * 60 + 360) % 360;
  return s > 0.15 && h >= 225 && h <= 300;
}

const LITERAL = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]*\)/g;

describe('no violet (v2 bans)', () => {
  it('knows violet when it sees it', () => {
    for (const v of ['#7B45F5', '#A78BFA', '#14082A', '#8B5CF6', '#8E7CF7', 'rgba(8,3,18,0.66)', '#4B54A8']) {
      expect(isVioletLiteral(v)).toBe(true);
    }
    for (const ok of ['#C8126A', '#F22481', '#0B0A0A', '#4F6B7C', '#FFFFFF', 'rgba(11, 10, 10, 0.66)', '#E8481E']) {
      expect(isVioletLiteral(ok)).toBe(false);
    }
  });

  it('leaves no violet colour literal in app, components, lib, hooks or store', () => {
    const hits: string[] = [];
    for (const dir of DIRS) {
      for (const abs of walk(path.join(ROOT, dir), [])) {
        const rel = path.relative(ROOT, abs).split(path.sep).join('/');
        if (WAVE2_EXEMPT.has(rel)) continue;
        fs.readFileSync(abs, 'utf8').split(/\r?\n/).forEach((line, i) => {
          if (/^\s*(\*|\/\/|\/\*)/.test(line)) return;
          for (const lit of line.match(LITERAL) ?? []) {
            if (isVioletLiteral(lit)) hits.push(`${rel}:${i + 1} ${lit}`);
          }
        });
      }
    }
    expect(hits).toEqual([]);
  });
});

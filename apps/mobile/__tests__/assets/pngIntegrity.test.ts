import { readFileSync, readdirSync, statSync } from 'fs';
import { inflateSync } from 'zlib';
import { join } from 'path';

/**
 * Every bundled PNG must actually decode.
 *
 * `assets/brand/roxy-icon.png` shipped TRUNCATED: 6699 of its 6832 bytes, an
 * IDAT chunk whose header promised 6356 bytes over a file that held 6239, and
 * no IEND at all. A copy had been cut short, and nothing anywhere noticed —
 * `require()` resolves a path, it does not decode an image, so tsc, eslint and
 * 1650 tests were all green over a Roxy FAB that painted an empty pink circle.
 * A screenshot found it.
 *
 * The failure class is "a binary asset is not what it claims to be", and no
 * amount of TypeScript can see it. This is the check that can.
 */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...pngFiles(path));
    else if (name.toLowerCase().endsWith('.png')) out.push(path);
  }
  return out;
}

/** Walks the chunk list the way a decoder does, and inflates the pixel data. */
function decodePng(buf: Buffer): { width: number; height: number; scanlines: number } {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');

  let pos = 8;
  let width = 0;
  let height = 0;
  let sawEnd = false;
  const idat: Buffer[] = [];

  while (pos + 8 <= buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.subarray(pos + 4, pos + 8).toString('latin1');
    const end = pos + 12 + length;
    if (end > buf.length) {
      throw new Error(`truncated: ${type} declares ${length} bytes, file holds ${buf.length - pos - 8}`);
    }
    if (type === 'IHDR') {
      width = buf.readUInt32BE(pos + 8);
      height = buf.readUInt32BE(pos + 12);
    }
    if (type === 'IDAT') idat.push(buf.subarray(pos + 8, pos + 8 + length));
    if (type === 'IEND') sawEnd = true;
    pos = end;
  }

  if (!sawEnd) throw new Error('no IEND chunk — the file ends early');
  // The zlib check is the one that caught it: a truncated stream fails its
  // Adler-32 even when the chunk lengths happen to line up.
  const scanlines = inflateSync(Buffer.concat(idat)).length;
  return { width, height, scanlines };
}

const files = pngFiles('assets');

describe('bundled PNG assets', () => {
  it('finds the assets to check, so an empty sweep cannot pass as clean', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s decodes', (file) => {
    const out = decodePng(readFileSync(file));
    expect(out.width).toBeGreaterThan(0);
    expect(out.height).toBeGreaterThan(0);
    expect(out.scanlines).toBeGreaterThan(0);
  });

  it('rejects a truncated file — proving the check can actually fail', () => {
    // Without this, an accidentally-permissive decoder would report every
    // asset healthy forever. This is the exact corruption that shipped.
    const good = readFileSync(files[0]);
    expect(() => decodePng(good.subarray(0, good.length - 140))).toThrow();
  });
});

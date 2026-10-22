import { Image, type ImageProps } from 'expo-image';

/**
 * How Roxy's images arrive (budget F15, motion-spec lane B).
 *
 * Wave 1 had no expo-image `transition` anywhere and no prefetch: a photo or
 * poster appeared as a hard cut, after the page had already landed, and a face
 * could show the previous author's for a frame on a recycled cell. Every
 * expo-image in the feed, Discover and the Archive takes its defaults from
 * here — passed as explicit `transition=` / `cachePolicy=` props so the static
 * feel scan can see them.
 */

/** A content image fades in over this — at least two frames, at most 150 ms (F15). */
export const IMAGE_FADE_MS = 120;

/**
 * Content images (photos, posters, covers, member photos): a cross-dissolve
 * from the placeholder or ground. A fade is not motion, so Reduce Motion keeps
 * it (motion-spec: cross-dissolve is the reduced-motion substitute).
 */
export const IMAGE_TRANSITION = {
  duration: IMAGE_FADE_MS,
  effect: 'cross-dissolve',
  timing: 'ease-out',
} as const satisfies NonNullable<ImageProps['transition']>;

/**
 * Faces and crests never fade: a recycled cell that faded its avatar in again
 * reads as a blink (F15 "no avatar flicker on recycle"). They pair with
 * `recyclingKey` so the previous face is never shown either.
 */
export const NO_TRANSITION = 0;

/** Decoded images stay in memory and on disk, so a swipe back is instant. */
export const IMAGE_CACHE = 'memory-disk' as const satisfies NonNullable<ImageProps['cachePolicy']>;

/** What the Network Information API tells us, where the browser has it. */
export interface ConnectionHint {
  effectiveType?: string;
  saveData?: boolean;
}

/** Data saver, or a 2G-class link: prefetching would only slow what she asked for. */
export function isConstrainedConnection(connection?: ConnectionHint | null): boolean {
  if (!connection) return false;
  if (connection.saveData) return true;
  return connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g';
}

function currentConnection(): ConnectionHint | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as Navigator & { connection?: ConnectionHint }).connection;
}

/** URLs already handed to the prefetcher this session (bounded, oldest out first). */
const warmed = new Set<string>();
const WARM_CAP = 300;

/** Test seam: forget what was warmed. */
export function resetPrefetchMemory(): void {
  warmed.clear();
}

function isFetchable(url: string | null | undefined): url is string {
  return typeof url === 'string' && /^https?:\/\//.test(url);
}

/**
 * Starts downloading `urls` into the image cache so they are decoded before
 * the page they belong to lands. Each URL is requested once per session; empty
 * values and non-file avatars (`preset:` faces) are skipped; nothing happens on
 * a constrained connection, so the requests she is waiting on go first (jank
 * audit #10). A failed prefetch is ignored — the image loads when shown.
 *
 * Returns the URLs it started, for tests and probes.
 */
export function prefetchImages(
  urls: readonly (string | null | undefined)[],
  opts: {
    prefetch?: (urls: string[]) => Promise<boolean>;
    connection?: ConnectionHint | null;
  } = {},
): string[] {
  const connection = 'connection' in opts ? opts.connection : currentConnection();
  if (isConstrainedConnection(connection)) return [];
  const fresh = [...new Set(urls.filter(isFetchable))].filter((u) => !warmed.has(u));
  if (fresh.length === 0) return [];
  for (const u of fresh) {
    warmed.add(u);
    if (warmed.size > WARM_CAP) warmed.delete(warmed.values().next().value as string);
  }
  const prefetch = opts.prefetch ?? ((list: string[]) => Image.prefetch(list));
  try {
    void prefetch(fresh).catch(() => undefined);
  } catch {
    // A synchronous throw from the platform prefetcher is as harmless as a rejection.
  }
  return fresh;
}

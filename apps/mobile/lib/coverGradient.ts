import { avatarGradient } from './avatars';

/**
 * The Archive's cover art.
 *
 * `archive_entries.cover_gradient` holds the DESIGN's own CSS verbatim —
 * `linear-gradient(160deg,#1E2A4E,#4A3A7A 55%,#D98A5E)` — seeded per entry by
 * migration 098 straight from the prototype. It is the closest thing the
 * Archive has to a poster, and React Native cannot read a CSS gradient string,
 * so without this parser those values sat in the database doing nothing while
 * the entry page rendered flat.
 *
 * src: docs/handoff/roxy-3.0/Roxy App.dc.html · ARCH fixtures, line 1521+ · 2026-09-05
 */

/** Matches a hex colour in the gradient's stop list, 3- or 6-digit. */
const HEX = /#(?:[0-9a-f]{3}|[0-9a-f]{6})\b/gi;

/**
 * The colours out of a CSS linear-gradient, in order.
 *
 * Returns null rather than a half-parsed result: one usable colour is not a
 * gradient, and rendering it as one paints a flat block where the design has a
 * picture. Only `linear-gradient` is accepted — a radial would need different
 * geometry and silently flattening it would be a worse lie than falling back.
 */
export function parseCoverGradient(css: string | null | undefined): string[] | null {
  if (!css) return null;
  if (!/^\s*linear-gradient\s*\(/i.test(css)) return null;

  const stops = css.match(HEX);
  // Two is the minimum that can actually ramp.
  if (!stops || stops.length < 2) return null;
  return stops;
}

/**
 * The gradient to paint for an entry: the stored one, or deterministic art
 * derived from its slug.
 *
 * An entry a member submitted has no gradient until a mod adds one, and it
 * still needs a cover. Deriving from the slug means the SAME art every time —
 * art that changed between renders would read as a loading glitch rather than
 * as a placeholder.
 */
export function coverGradientFor(
  css: string | null | undefined,
  slug: string
): string[] {
  return parseCoverGradient(css) ?? [...avatarGradient(slug)];
}

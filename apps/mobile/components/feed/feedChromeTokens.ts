import type { TextStyle } from 'react-native';

/**
 * The one legibility problem every full-bleed cell has, and the three answers.
 *
 * Chrome sits over media the app has never seen. TikTok's own ad specs tell
 * advertisers to keep artwork clear of the regions where "buttons, usernames,
 * and captions may appear" — which is an admission that white-on-anything is a
 * coin flip, not a solution. So the contrast is built rather than hoped for:
 *
 *  1. `MEDIA_SCRIM` — a bottom-anchored wash that reaches 0.85 alpha exactly
 *     where the handle, caption and community line sit. Against the worst case,
 *     a pure-white frame, `#fff` under `rgba(0,0,0,0.85)` composites to
 *     (38,38,38) and white text on that is 15.9:1. Every small text run in the
 *     chrome lives inside that band, which is why the caption is capped at two
 *     lines: three would push the first line out of it.
 *  2. `CHROME_SHADOW` — a tight dark halo on every white glyph. The rail's top
 *     reaches up past the scrim's opaque band, and a shadow is the only
 *     treatment that works without knowing what is behind it. WCAG 2.2 SC 1.4.11
 *     asks 3:1 of a graphical object against *adjacent* colour, and the halo IS
 *     the adjacent colour.
 *  3. `BRAND_VEIL` — for the cells that supply their own background. The brand
 *     gradient cannot carry white text unhelped: `#FF6A2E` against white is
 *     2.86:1, which fails even the 3:1 large-text bar. Under a 42% `#1a0a2e`
 *     veil that stop becomes (159,66,46) → 6.38:1, and `#E81C8E` → 8.35:1. So
 *     the gradient stays the brand and the veil makes it legal.
 *
 * src: https://ads.tiktok.com/help/article/tiktok-auction-in-feed-ads · read 2026-08-06
 * src: https://www.w3.org/TR/WCAG22/#contrast-minimum · WCAG 2.2 SC 1.4.3, 1.4.11 · 2026-08-06
 */
export const MEDIA_SCRIM = ['transparent', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.85)'] as const;
export const MEDIA_SCRIM_LOCATIONS = [0.35, 0.62, 1] as const;

export const CHROME_SHADOW: TextStyle = {
  textShadowColor: 'rgba(0,0,0,0.65)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 6,
};

/** `components/profile/ProfileCard.tsx` — one brand ramp, not a second palette. */
export const BRAND_GRADIENT = ['#FF6A2E', '#FF2F71', '#E81C8E'] as const;

/** `THEMES.dark.background` at the alpha the contrast maths above assumes. */
export const BRAND_VEIL = 'rgba(26,10,46,0.42)';

/**
 * How much of the page's right edge the rail owns.
 *
 * Body content is padded clear of it rather than sliding under it, because a
 * caption that runs behind the like button is unreadable however good the scrim
 * is. 44dp of control plus the 12dp inset plus breathing room.
 */
export const RAIL_GUTTER = 78;

/** Below the bottom of the rail, above the safe-area inset. */
export const CHROME_BOTTOM = 34;

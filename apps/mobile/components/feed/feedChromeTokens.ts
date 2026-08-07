import type { TextStyle } from 'react-native';

/**
 * The one legibility problem every full-bleed cell has, and how it is actually
 * solved.
 *
 * Chrome sits over media the app has never seen. TikTok's own ad specs tell
 * advertisers to keep artwork clear of the regions where "buttons, usernames,
 * and captions may appear" — an admission that white-on-anything is a coin
 * flip, not a solution. So the contrast is built rather than hoped for.
 *
 * ## Why the old scrim did not work
 *
 * It was `['transparent', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.85)']` at
 * `[0.35, 0.62, 1]` over `StyleSheet.absoluteFill` — stops expressed as a share
 * of the PAGE, laid under an identity block positioned in fixed dp from the
 * bottom. The alpha the text sat on was therefore a function of how tall the
 * page happened to be. Over a white photo that measured:
 *
 *   page   handle   caption   "more"
 *   320dp  1.86:1   2.40:1    3.63:1
 *   400dp  2.62:1   3.25:1    4.31:1
 *   620dp  4.63:1   5.28:1    5.54:1
 *
 * all against a 4.5:1 bar. Connect's feed — under a header AND a sub-tab row
 * AND above a 68dp tab bar — is the shortest page in the app and so the worst
 * case. The headline the old comment claimed, "15.9:1", was also wrong on its
 * own terms: `255 × 0.15` is 38.25, not 34, which is 15.08:1.
 *
 * ## The three answers now
 *
 *  1. **A dp-anchored scrim.** The dark band is not a share of the page: it is
 *     the identity block's own backing, sized by the block, with a fixed
 *     `MEDIA_SCRIM_FADE` ramp above it. Every glyph in the block is therefore at
 *     or below `MEDIA_SCRIM_TOP_ALPHA` whatever the page height and however long
 *     the caption — 6.20:1 for `#fff` over a white frame at the very top of the
 *     band, better everywhere below it. `MEDIA_SCRIM_MIN_BODY` keeps the crest
 *     inside the band on a post with no handle, caption or community line.
 *  2. **`RAIL_BACKING` — the rail's own plate.** The rail's top sits ~358dp above
 *     the page bottom; a scrim tall enough to reach it would veil the whole
 *     frame. So each rail control carries its own backing instead. 0.82 is not
 *     decoration: it is the lowest alpha at which the LIKED heart (`#E81C8E`,
 *     luminance 0.199) still clears 3:1 against its own plate over a white
 *     frame. At 0.80 it lands on exactly 3.00 with no margin; at 0.55 it is
 *     1.13:1 and the state is invisible.
 *  3. **`BRAND_VEIL` — for cells that supply their own background.** The brand
 *     gradient cannot carry white text unhelped: `#FF6A2E` against white is
 *     2.86:1, failing even the 3:1 large-text bar. Under a 42% `#1a0a2e` veil
 *     that stop becomes (159,66,46) → 6.38:1, and `#E81C8E` → 8.35:1.
 *
 * `CHROME_SHADOW` is NOT one of the answers and must never be counted as one.
 * WCAG defines no method for scoring a text shadow — there is no algorithm that
 * takes a blur radius and returns a ratio — so a halo can look like help and
 * prove nothing. It stays because it genuinely helps a glyph read against a
 * busy frame, and every ratio in `__tests__/components/feedChromeContrast.test.ts`
 * is computed as though it were not there.
 *
 * src: https://ads.tiktok.com/help/article/tiktok-auction-in-feed-ads · read 2026-08-06
 * src: https://www.w3.org/TR/WCAG22/#contrast-minimum · WCAG 2.2 SC 1.4.3, 1.4.11 · 2026-08-07
 */

/** Alpha of the scrim at the TOP of the identity block — its lightest point. */
export const MEDIA_SCRIM_TOP_ALPHA = 0.62;

/** Alpha at the very bottom of the page. */
export const MEDIA_SCRIM_BOTTOM_ALPHA = 0.88;

/**
 * The ramp above the block, in dp.
 *
 * Fixed rather than proportional for the same reason the band is: a ramp
 * expressed as a share of the page is a different ramp on every device. It sits
 * entirely ABOVE the text, so its length is a matter of taste and never of
 * contrast.
 */
export const MEDIA_SCRIM_FADE = 96;

/**
 * Floor on the dark band, in dp.
 *
 * A post whose author and community both failed to join, with no caption,
 * renders an empty identity block — and the crest, which is absolutely
 * positioned and always drawn, would then hang above the band with nothing
 * behind its ring. `CHROME_BOTTOM + CREST_SIZE + 12` covers it.
 */
export const MEDIA_SCRIM_MIN_BODY = 96;

/** Gradient stops for the ramp above the block. */
export const MEDIA_SCRIM_FADE_COLORS = [
  'rgba(0,0,0,0)',
  `rgba(0,0,0,${MEDIA_SCRIM_TOP_ALPHA})`,
] as const;

/** Gradient stops for the band the chrome actually sits on. */
export const MEDIA_SCRIM_BODY_COLORS = [
  `rgba(0,0,0,${MEDIA_SCRIM_TOP_ALPHA})`,
  `rgba(0,0,0,${MEDIA_SCRIM_BOTTOM_ALPHA})`,
] as const;

/**
 * The scrim's alpha at a point `dpAboveBottom` above the bottom of the page,
 * given the height the dark band was laid out at.
 *
 * Note what is NOT a parameter: the page height. That is the fix — the model
 * and the render agree that this geometry is measured in dp from the bottom
 * edge, so a cell in Connect's short frame and a cell in a full-screen pager
 * put their text on exactly the same backing.
 */
export function scrimAlphaAt(dpAboveBottom: number, bodyHeight: number): number {
  if (dpAboveBottom <= 0) return MEDIA_SCRIM_BOTTOM_ALPHA;
  if (bodyHeight <= 0) return 0;
  if (dpAboveBottom <= bodyHeight) {
    const fromTop = (bodyHeight - dpAboveBottom) / bodyHeight;
    return MEDIA_SCRIM_TOP_ALPHA
      + (MEDIA_SCRIM_BOTTOM_ALPHA - MEDIA_SCRIM_TOP_ALPHA) * fromTop;
  }
  const intoFade = dpAboveBottom - bodyHeight;
  if (intoFade >= MEDIA_SCRIM_FADE) return 0;
  return MEDIA_SCRIM_TOP_ALPHA * (1 - intoFade / MEDIA_SCRIM_FADE);
}

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
 * Alpha of the plate behind each rail control. See note 2 above — this number
 * is set by the liked heart, not by taste.
 */
export const RAIL_BACKING_ALPHA = 0.82;

/** The plate itself. */
export const RAIL_BACKING = `rgba(0,0,0,${RAIL_BACKING_ALPHA})`;

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

/** The community crest's diameter. Shared so the scrim can guarantee it cover. */
export const CREST_SIZE = 50;

/**
 * The caption's line budgets — and why an expanded caption still has one.
 *
 * The band is bottom-anchored with the identity block as its content, so its
 * height is whatever the block needs. That is the fix for contrast (see above)
 * and it is also the reason the caption cannot be allowed to grow without a
 * ceiling: `numberOfLines={undefined}` over uncapped `post.content` made the
 * band's height a function of what somebody typed. A 600-character caption is
 * about fifteen lines — `15 × CAPTION_LINE_HEIGHT` = 300dp — against Connect's
 * ~320dp page. The scrim then stretched over the whole frame, the text ran off
 * the top, and there was no "less" to undo it.
 *
 * Expanded is therefore capped at `CAPTION_EXPANDED_LINES`, which is
 * `6 × 20` = 120dp of text: with the handle, the community line and
 * `CHROME_BOTTOM` the band lands around 210dp, still under two thirds of the
 * shortest page in the app. Anything longer is not truncated in silence — it is
 * handed to the detail surface, the same trade `TextCell` makes at its own
 * `READ_MORE_CAP`.
 *
 * The character counts are the stand-in for measuring. `numberOfLines`
 * truncates but reports nothing back, so the affordance has to be offered on
 * length; ~40 characters is what a line holds at `caption`'s size once the rail
 * has taken `RAIL_GUTTER`. `CAPTION_CAP` was already 80 for exactly this reason
 * — it is now written as the product it always was.
 */
export const CAPTION_LINE_CHARS = 40;

/** `s.caption`'s leading, exported so the dp maths above is checkable. */
export const CAPTION_LINE_HEIGHT = 20;

/** Collapsed. Two, not TikTok's four: the community row needs the space. */
export const CAPTION_COLLAPSED_LINES = 2;

/** Expanded, and bounded. */
export const CAPTION_EXPANDED_LINES = 6;

/** Longer than this and the collapsed caption is being cut, so offer "more". */
export const CAPTION_CAP = CAPTION_COLLAPSED_LINES * CAPTION_LINE_CHARS;

/** Longer than this and expanding would not show it all either. */
export const CAPTION_EXPANDED_CAP = CAPTION_EXPANDED_LINES * CAPTION_LINE_CHARS;

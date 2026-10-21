import { POST_REACTIONS, type PostReaction } from '../../lib/postReactions';

/**
 * The reaction picker's geometry (direction v2 › Reactions, board v2-04).
 *
 * A 64 dp pill with the six emoji at 30 dp in 44 dp cells; the emoji under
 * her finger grows to 44 dp and lifts 26 dp. It springs out to the START side
 * of the button that opened it, `gap` away, vertically centred on it, ❤️
 * furthest from the button and 💜 nearest (the board's order). Shared with
 * chat later, so it lives here rather than in the feed's tokens.
 */
export const PICKER = {
  height: 64,
  cell: 44,
  emoji: 30,
  hoverEmoji: 44,
  lift: 26,
  pad: 8,
  gap: 8,
  /** Room above the pill where a lifted finger still counts as on it. */
  slopAbove: 48,
  /** Room below the pill (her thumb covers the lower edge). */
  slopBelow: 24,
  /** Never closer than this to the page's start edge. */
  edge: 4,
  /** Long-press before the picker opens (direction: 300 ms). */
  longPressMs: 300,
  /** A finger that moved further than this before opening is scrolling. */
  tapSlop: 10,
  /** Stagger between items as they spring out, from the button's side. */
  staggerMs: 20,
} as const;

/** The pill's width: six cells plus its padding. */
export const PICKER_WIDTH = PICKER.pad * 2 + PICKER.cell * POST_REACTIONS.length;

/** The emoji on the reaction disc. 48 dp disc, emoji sized to sit inside it. */
export const DISC_EMOJI = 26;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where the pill sits for a button at `anchor` (both in the host's coordinates). */
export function pickerFrame(anchor: Box): Box {
  const right = anchor.x - PICKER.gap;
  const left = Math.max(PICKER.edge, right - PICKER_WIDTH);
  const top = anchor.y + anchor.height / 2 - PICKER.height / 2;
  return { x: left, y: top, width: PICKER_WIDTH, height: PICKER.height };
}

/** The emoji under a finger at `point` (host coordinates), or none. */
export function pickerHit(anchor: Box, point: { x: number; y: number }): PostReaction | null {
  const frame = pickerFrame(anchor);
  if (point.y < frame.y - PICKER.slopAbove || point.y > frame.y + frame.height + PICKER.slopBelow) {
    return null;
  }
  const index = Math.floor((point.x - frame.x - PICKER.pad) / PICKER.cell);
  return index >= 0 && index < POST_REACTIONS.length ? POST_REACTIONS[index] : null;
}

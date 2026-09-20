import { Gesture } from 'react-native-gesture-handler';

/**
 * How far a finger may travel and still count as a tap.
 *
 * TikTok's contract: a vertical drag pages the feed. A tap (or a double tap
 * like) only fires when the finger barely moved. A slop this small is what
 * stops a swipe from becoming a like, and a like-press from eating the scroll.
 */
export const FEED_TAP_SLOP = 12;

/**
 * Double-tap likes, single-tap pauses. Exclusive so a like never also pauses.
 * Movement beyond `FEED_TAP_SLOP` fails both, and the pager takes the swipe.
 */
export function feedMediaTaps(
  onDoubleTap: () => void,
  onSingleTap: () => void,
) {
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDelay(260)
    .maxDistance(FEED_TAP_SLOP)
    .maxDeltaY(FEED_TAP_SLOP)
    .runOnJS(true)
    .onEnd((_event, success) => { if (success) onDoubleTap(); });

  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .maxDistance(FEED_TAP_SLOP)
    .maxDeltaY(FEED_TAP_SLOP)
    .runOnJS(true)
    .onEnd((_event, success) => { if (success) onSingleTap(); });

  return Gesture.Exclusive(doubleTap, singleTap);
}

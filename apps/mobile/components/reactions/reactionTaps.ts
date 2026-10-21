import { Gesture } from 'react-native-gesture-handler';
import { FEED_TAP_SLOP } from '../../lib/feedMediaTaps';

export type TapPoint = { x: number; y: number };

const noop = (): void => undefined;

/**
 * Double tap reacts, single tap pauses (a video). Exclusive, so a reaction
 * never also pauses; movement past `FEED_TAP_SLOP` fails both and the pager
 * takes the swipe. The same contract as `lib/feedMediaTaps.ts`, plus the
 * point: the ❤️ pops where her thumb was (direction v2 › Reactions).
 */
export function reactionTaps(
  onDoubleTap: (point: TapPoint) => void,
  onSingleTap: () => void = noop,
) {
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDelay(260)
    .maxDistance(FEED_TAP_SLOP)
    .maxDeltaY(FEED_TAP_SLOP)
    .runOnJS(true)
    .onEnd((event, success) => { if (success) onDoubleTap({ x: event.x, y: event.y }); });

  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .maxDistance(FEED_TAP_SLOP)
    .maxDeltaY(FEED_TAP_SLOP)
    .runOnJS(true)
    .onEnd((_event, success) => { if (success) onSingleTap(); });

  return Gesture.Exclusive(doubleTap, singleTap);
}

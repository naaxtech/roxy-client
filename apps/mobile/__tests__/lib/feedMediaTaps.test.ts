import { FEED_TAP_SLOP, feedMediaTaps } from '../../lib/feedMediaTaps';

type Chain = {
  numberOfTaps: jest.Mock;
  maxDelay: jest.Mock;
  maxDistance: jest.Mock;
  maxDeltaY: jest.Mock;
  runOnJS: jest.Mock;
  onEnd: jest.Mock;
};

const taps: Chain[] = [];

jest.mock('react-native-gesture-handler', () => {
  const tap = (): Chain => {
    const self = {} as Chain;
    self.numberOfTaps = jest.fn(() => self);
    self.maxDelay = jest.fn(() => self);
    self.maxDistance = jest.fn(() => self);
    self.maxDeltaY = jest.fn(() => self);
    self.runOnJS = jest.fn(() => self);
    self.onEnd = jest.fn(() => self);
    taps.push(self);
    return self;
  };
  return {
    Gesture: {
      Tap: tap,
      Exclusive: (...parts: unknown[]) => parts,
    },
  };
});

describe('feedMediaTaps — a swipe is a page, not a like', () => {
  beforeEach(() => { taps.length = 0; });

  it('fails both taps as soon as the finger moves more than the slop', () => {
    expect(FEED_TAP_SLOP).toBe(12);
    feedMediaTaps(jest.fn(), jest.fn());
    expect(taps).toHaveLength(2);
    for (const tap of taps) {
      expect(tap.maxDistance).toHaveBeenCalledWith(FEED_TAP_SLOP);
      expect(tap.maxDeltaY).toHaveBeenCalledWith(FEED_TAP_SLOP);
    }
  });

  it('keeps like and pause exclusive, so a double tap does not also pause', () => {
    const like = jest.fn();
    const pause = jest.fn();
    const composed = feedMediaTaps(like, pause);
    expect(composed).toHaveLength(2);
    expect(taps[0].numberOfTaps).toHaveBeenCalledWith(2);
    expect(taps[1].numberOfTaps).toHaveBeenCalledWith(1);
  });
});

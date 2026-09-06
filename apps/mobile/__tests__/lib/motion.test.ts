import { Animated } from 'react-native';
import { POP_FROM, SNAP_SPRING, popInStyle, runSnap } from '../../lib/motion';

describe('Roxy snap motion', () => {
  it('never drives appearance with opacity', () => {
    const scale = new Animated.Value(1);
    expect(popInStyle(scale)).not.toHaveProperty('opacity');
    expect(popInStyle(scale).transform).toEqual([{ scale }]);
  });

  it('uses a high-tension spring so the pop settles fast', () => {
    expect(SNAP_SPRING.tension).toBeGreaterThanOrEqual(400);
    expect(SNAP_SPRING.friction).toBeGreaterThanOrEqual(12);
    expect(POP_FROM).toBeLessThan(0.85);
  });

  it('jumps to the end value when Reduce Motion is on', () => {
    const value = new Animated.Value(0);
    const setValue = jest.spyOn(value, 'setValue');
    runSnap(value, 1, true);
    expect(setValue).toHaveBeenCalledWith(1);
  });
});

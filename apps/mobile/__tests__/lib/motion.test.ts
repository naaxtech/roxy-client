import { Animated } from 'react-native';
import {
  POP_FROM,
  SNAP_SPRING,
  SPRING,
  PRESS,
  animatedSpring,
  popInStyle,
  runSnap,
  runSpring,
} from '../../lib/motion';

describe('Roxy snap motion', () => {
  it('never drives appearance with opacity', () => {
    const scale = new Animated.Value(1);
    expect(popInStyle(scale)).not.toHaveProperty('opacity');
    expect(popInStyle(scale).transform).toEqual([{ scale }]);
  });

  // SNAP_SPRING is superseded by SPRING.spatial (v2) but stays exported,
  // unchanged, for any caller outside this lane (Wave 2 files still read it).
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

/**
 * Design direction v2 › Motion: M3 Expressive's spring tokens, ported as
 * physical springs. damping = 2·ζ·√stiffness, mass 1.
 */
describe('M3 Expressive spring tokens', () => {
  const TABLE: [keyof typeof SPRING, number, number, number][] = [
    ['fastSpatial', 800, 33.9, 0.6],
    ['spatial', 380, 31.2, 0.8],
    ['slowSpatial', 200, 22.6, 0.8],
    ['fastEffects', 3800, 123.3, 1],
    ['effects', 1600, 80.0, 1],
    ['slowEffects', 800, 56.6, 1],
    ['calm', 700, 47.6, 0.9],
  ];

  it.each(TABLE)('%s is stiffness %i, damping %d (ζ %d), mass 1', (name, stiffness, damping, zeta) => {
    expect(SPRING[name].mass).toBe(1);
    expect(SPRING[name].stiffness).toBe(stiffness);
    expect(SPRING[name].damping).toBeCloseTo(damping, 1);
    expect(SPRING[name].damping).toBeCloseTo(2 * zeta * Math.sqrt(stiffness), 0);
  });

  // reanimated 3.10: `dampingRatio` without `duration` switches to the
  // duration-based spring, which defaults to 2000 ms — every press would crawl.
  it.each(TABLE)('%s never carries dampingRatio or duration', (name) => {
    expect(SPRING[name]).not.toHaveProperty('dampingRatio');
    expect(SPRING[name]).not.toHaveProperty('duration');
  });

  it('has exactly the seven tokens of the direction', () => {
    expect(Object.keys(SPRING).sort()).toEqual(TABLE.map(([n]) => n).sort());
  });

  it('effects springs never overshoot (critically damped, ζ = 1)', () => {
    for (const name of ['fastEffects', 'effects', 'slowEffects'] as const) {
      const { stiffness, damping, mass } = SPRING[name];
      expect(damping / (2 * Math.sqrt(stiffness * mass))).toBeGreaterThanOrEqual(0.99);
    }
  });

  it('animatedSpring() carries the same physics to the legacy Animated API, on the native driver', () => {
    expect(animatedSpring('fastSpatial')).toEqual({
      mass: 1,
      stiffness: 800,
      damping: SPRING.fastSpatial.damping,
      useNativeDriver: true,
    });
    expect(animatedSpring('fastEffects', false).useNativeDriver).toBe(false);
  });

  it('runSnap now springs with SPRING.spatial instead of the v0 tension/friction pair', () => {
    const spring = jest.spyOn(Animated, 'spring');
    const value = new Animated.Value(0);
    runSnap(value, 1, false);
    expect(spring).toHaveBeenCalledWith(value, expect.objectContaining({
      toValue: 1,
      stiffness: SPRING.spatial.stiffness,
      damping: SPRING.spatial.damping,
      mass: 1,
    }));
    expect(spring.mock.calls[0][1]).not.toHaveProperty('tension');
    spring.mockRestore();
  });

  it('runSpring jumps to the end under Reduce Motion, else springs with the named token', () => {
    const value = new Animated.Value(0);
    const setValue = jest.spyOn(value, 'setValue');
    runSpring(value, 0.5, 'fastSpatial', true);
    expect(setValue).toHaveBeenCalledWith(0.5);

    const spring = jest.spyOn(Animated, 'spring');
    runSpring(value, 1, 'calm', false);
    expect(spring).toHaveBeenCalledWith(value, expect.objectContaining({
      toValue: 1,
      stiffness: 700,
    }));
    spring.mockRestore();
  });
});

describe('press tokens (Duolingo + M3)', () => {
  it('scales to 0.96, lays a 10% ink state layer (M3; P5 lifted light from 8%), morphs pills to 12, drops the primary 3 dp', () => {
    expect(PRESS.scale).toBe(0.96);
    expect(PRESS.stateLayer.light).toBe(0.1);
    expect(PRESS.stateLayer.dark).toBe(0.1);
    expect(PRESS.radius).toBe(12);
    expect(PRESS.lipDrop).toBe(3);
  });
});

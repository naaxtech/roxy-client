/**
 * `headStart` (lane C, F1): a press-in from rest leaves one 60 Hz frame into
 * its own spring, so the first painted frame already shows it. Reanimated
 * paints an animation's first step a frame after it starts; a direct
 * assignment paints on the next frame. Same trajectory, one frame sooner.
 */
import { REST, SPRING, headStart, springAt } from '../../lib/motion';

const FRAME = 1000 / 60;

describe('headStart', () => {
  it('a 0 → 1 progress starts at the spring\'s first-frame position, carrying its velocity', () => {
    const h = springAt('fastSpatial', FRAME);
    const { start, config } = headStart(0, 1);
    expect(start).toBeCloseTo(h.x, 9);
    expect(config).toMatchObject({ ...SPRING.fastSpatial, reduceMotion: 'never' });
    expect(config.velocity).toBeCloseTo(h.v, 9);
  });

  it('scales to the travel: a 3 dp drop in pixels rests at REST.px', () => {
    const h = springAt('fastSpatial', FRAME);
    const { start, config } = headStart(0, 3, 'fastSpatial', { px: true });
    expect(start).toBeCloseTo(3 * h.x, 9);
    expect(config.velocity).toBeCloseTo(3 * h.v, 9);
    expect(config.restDisplacementThreshold).toBe(REST.px);
  });

  it('works downward (scale 1 → 0.96) and with the effects token', () => {
    const h = springAt('fastEffects', FRAME);
    const { start, config } = headStart(1, 0.96, 'fastEffects');
    expect(start).toBeCloseTo(1 - 0.04 * h.x, 9);
    expect(config.velocity).toBeCloseTo(-0.04 * h.v, 9);
    expect(config.stiffness).toBe(SPRING.fastEffects.stiffness);
  });

  it('the head start is visible but small: 5-15% of the travel', () => {
    const { start } = headStart(0, 1);
    expect(start).toBeGreaterThan(0.05);
    expect(start).toBeLessThan(0.15);
  });
});

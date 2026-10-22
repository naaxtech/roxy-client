/**
 * lib/haptics is shared by chat (`haptic(kind)`) and feed/gate (`tapLight`,
 * `celebrate`). These pin the contract both lanes relied on: the right engine
 * call per kind, nothing on web, and never a throw.
 *
 * Wave 3 (polish/motion-spec.md §3.3, decision P3): haptics STAY under Reduce
 * Motion, so the two "stays still under reduced motion" cases below now assert
 * the opposite. The full §3.3 contract (kinds, Android native path, fallback)
 * is in __tests__/feel/haptics.test.ts; this file runs on iOS (jest default).
 */
const mockImpact = jest.fn();
const mockNotify = jest.fn();
const mockSelect = jest.fn();

jest.mock('expo-haptics', () => ({
  impactAsync: (...a: unknown[]) => mockImpact(...a),
  notificationAsync: (...a: unknown[]) => mockNotify(...a),
  selectionAsync: (...a: unknown[]) => mockSelect(...a),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
}));

import { Platform } from 'react-native';
import { celebrate, haptic, tapLight } from '../../lib/haptics';

const realOS = Platform.OS;

beforeEach(() => {
  for (const m of [mockImpact, mockNotify, mockSelect]) {
    m.mockReset();
    m.mockReturnValue(Promise.resolve());
  }
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
});

afterAll(() => {
  Object.defineProperty(Platform, 'OS', { value: realOS, configurable: true });
});

describe('haptic(kind) — chat', () => {
  it('maps each kind to its engine call', () => {
    // Wave 3: the kind is required (it used to default to 'tap').
    haptic('tap');
    expect(mockImpact).toHaveBeenLastCalledWith('light');
    haptic('select');
    expect(mockSelect).toHaveBeenCalledTimes(1);
    haptic('success');
    expect(mockNotify).toHaveBeenLastCalledWith('success');
    haptic('warning');
    expect(mockNotify).toHaveBeenLastCalledWith('warning');
  });

  // Wave 3 (§3.3 P3): was 'stays still under reduced motion'; haptics now stay on.
  it('still fires under reduced motion', () => {
    haptic('success', true);
    expect(mockNotify).toHaveBeenCalledWith('success');
  });
});

describe('tapLight / celebrate — feed', () => {
  it('tapLight is a light impact, celebrate a success notification', () => {
    tapLight();
    expect(mockImpact).toHaveBeenCalledWith('light');
    celebrate();
    expect(mockNotify).toHaveBeenCalledWith('success');
  });

  // Wave 3 (§3.3 P3): was 'stays still under reduced motion'; haptics now stay on.
  it('still fires under reduced motion', () => {
    tapLight(true);
    celebrate(true);
    expect(mockImpact).toHaveBeenCalledWith('light');
    expect(mockNotify).toHaveBeenCalledWith('success');
  });
});

describe('every export', () => {
  it('is a no-op on web', () => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    haptic('success');
    tapLight();
    celebrate();
    expect(mockImpact).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('never throws, whether the engine throws or rejects', async () => {
    mockImpact.mockImplementation(() => {
      throw new Error('no vibrator');
    });
    mockNotify.mockReturnValue(Promise.reject(new Error('no engine')));
    expect(() => haptic('tap')).not.toThrow();
    expect(() => tapLight()).not.toThrow();
    expect(() => celebrate()).not.toThrow();
    expect(() => haptic('warning')).not.toThrow();
    // Let the rejected promises settle: an unhandled rejection would fail the run.
    await new Promise((r) => setTimeout(r, 0));
  });
});

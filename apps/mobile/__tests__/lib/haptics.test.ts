/**
 * lib/haptics is shared by chat (`haptic(kind)`) and feed/gate (`tapLight`,
 * `celebrate`). These pin the contract both lanes relied on: the right engine
 * call per kind, nothing on web, nothing under reduced motion, and never a throw.
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
    haptic();
    expect(mockImpact).toHaveBeenLastCalledWith('light');
    haptic('select');
    expect(mockSelect).toHaveBeenCalledTimes(1);
    haptic('success');
    expect(mockNotify).toHaveBeenLastCalledWith('success');
    haptic('warning');
    expect(mockNotify).toHaveBeenLastCalledWith('warning');
  });

  it('stays still under reduced motion', () => {
    haptic('success', true);
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe('tapLight / celebrate — feed', () => {
  it('tapLight is a light impact, celebrate a success notification', () => {
    tapLight();
    expect(mockImpact).toHaveBeenCalledWith('light');
    celebrate();
    expect(mockNotify).toHaveBeenCalledWith('success');
  });

  it('stays still under reduced motion', () => {
    tapLight(true);
    celebrate(true);
    expect(mockImpact).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
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
    expect(() => haptic()).not.toThrow();
    expect(() => tapLight()).not.toThrow();
    expect(() => celebrate()).not.toThrow();
    expect(() => haptic('warning')).not.toThrow();
    // Let the rejected promises settle: an unhandled rejection would fail the run.
    await new Promise((r) => setTimeout(r, 0));
  });
});

/**
 * F13, jest half (polish/motion-spec.md §2 F13, §3.3 haptic map, decisions P3/P4).
 *
 * The contract every call site relies on:
 *   - four kinds: selection, light, medium, success;
 *   - never on web;
 *   - Reduce Motion does NOT silence a haptic (the direction: "haptics stay");
 *   - Android goes through the local `RoxyHaptics` module (View.performHapticFeedback,
 *     which honours the phone's Touch feedback setting) with the §3.3 constant per kind;
 *   - when that module is missing (an installed build older than the module, Expo Go),
 *     Android falls back to expo-haptics; iOS always uses expo-haptics;
 *   - one engine call per haptic, and never a throw into a gesture handler.
 */
const mockImpact = jest.fn();
const mockNotify = jest.fn();
const mockSelect = jest.fn();
const mockPerform = jest.fn();
const mockNative: { current: { perform: jest.Mock } | null } = { current: null };

jest.mock('expo-haptics', () => ({
  impactAsync: (...a: unknown[]) => mockImpact(...a),
  notificationAsync: (...a: unknown[]) => mockNotify(...a),
  selectionAsync: (...a: unknown[]) => mockSelect(...a),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

jest.mock('../../modules/roxy-haptics', () => ({
  loadRoxyHaptics: () => mockNative.current,
}));

import { Platform } from 'react-native';
import { androidHapticFor, celebrate, haptic, tapLight } from '../../lib/haptics';
import type { HapticKind } from '../../lib/haptics';

const realOS = Platform.OS;
const realVersion = Platform.Version;

function setPlatform(os: 'ios' | 'android' | 'web', version: number | string = os === 'android' ? 34 : '17.0'): void {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  Object.defineProperty(Platform, 'Version', { value: version, configurable: true });
}

function engineCalls(): number {
  return mockImpact.mock.calls.length + mockNotify.mock.calls.length
    + mockSelect.mock.calls.length + mockPerform.mock.calls.length;
}

beforeEach(() => {
  for (const m of [mockImpact, mockNotify, mockSelect, mockPerform]) {
    m.mockReset();
    m.mockReturnValue(Promise.resolve());
  }
  mockPerform.mockReturnValue(Promise.resolve(true));
  mockNative.current = { perform: mockPerform };
  setPlatform('ios');
});

afterAll(() => {
  Object.defineProperty(Platform, 'OS', { value: realOS, configurable: true });
  Object.defineProperty(Platform, 'Version', { value: realVersion, configurable: true });
});

const KINDS: HapticKind[] = ['selection', 'light', 'medium', 'success'];

describe('web', () => {
  it('never calls an engine, for any kind or alias', () => {
    setPlatform('web', 0);
    for (const k of KINDS) haptic(k);
    haptic('tap');
    haptic('select');
    haptic('warning');
    tapLight();
    celebrate();
    expect(engineCalls()).toBe(0);
  });
});

describe('Reduce Motion', () => {
  it('still fires on iOS: the reducedMotion argument no longer silences a haptic', () => {
    haptic('selection', true);
    tapLight(true);
    celebrate(true);
    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(mockImpact).toHaveBeenCalledWith('light');
    expect(mockNotify).toHaveBeenCalledWith('success');
  });

  it('still fires on Android through the native module', () => {
    setPlatform('android', 34);
    haptic('light', true);
    expect(mockPerform).toHaveBeenCalledWith('CONTEXT_CLICK');
  });
});

describe('iOS: expo-haptics per §3.3', () => {
  it('maps each kind to its UIFeedbackGenerator call', () => {
    haptic('selection');
    expect(mockSelect).toHaveBeenCalledTimes(1);
    haptic('light');
    expect(mockImpact).toHaveBeenLastCalledWith('light');
    haptic('medium');
    expect(mockImpact).toHaveBeenLastCalledWith('medium');
    haptic('success');
    expect(mockNotify).toHaveBeenLastCalledWith('success');
  });

  it('never consults the Android module', () => {
    for (const k of KINDS) haptic(k);
    expect(mockPerform).not.toHaveBeenCalled();
  });
});

describe('Android: View.performHapticFeedback constants per §3.3', () => {
  it.each([
    ['selection', 33, 'CLOCK_TICK'],
    ['selection', 34, 'SEGMENT_TICK'],
    ['light', 24, 'CONTEXT_CLICK'],
    ['light', 34, 'CONTEXT_CLICK'],
    ['medium', 29, 'LONG_PRESS'],
    ['medium', 30, 'CONFIRM'],
    ['success', 29, 'LONG_PRESS'],
    ['success', 30, 'CONFIRM'],
  ] as const)('%s on API %i -> %s', (kind, api, constant) => {
    expect(androidHapticFor(kind, api)).toBe(constant);
    setPlatform('android', api);
    haptic(kind);
    expect(mockPerform).toHaveBeenCalledTimes(1);
    expect(mockPerform).toHaveBeenCalledWith(constant);
  });

  it('never also buzzes expo-haptics (Vibrator ignores the Touch feedback setting)', () => {
    setPlatform('android', 34);
    for (const k of KINDS) haptic(k);
    expect(mockImpact).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('does not fall back when the system declined (Touch feedback off returns false)', async () => {
    setPlatform('android', 34);
    mockPerform.mockReturnValue(Promise.resolve(false));
    haptic('selection');
    await new Promise((r) => setTimeout(r, 0));
    expect(mockSelect).not.toHaveBeenCalled();
    expect(engineCalls()).toBe(1);
  });

  it('reads a string Platform.Version as an API level', () => {
    setPlatform('android', '34');
    haptic('selection');
    expect(mockPerform).toHaveBeenCalledWith('SEGMENT_TICK');
  });
});

describe('Android without the native module (older installed build, Expo Go)', () => {
  it('falls back to expo-haptics with the iOS mapping', () => {
    setPlatform('android', 34);
    mockNative.current = null;
    haptic('selection');
    expect(mockSelect).toHaveBeenCalledTimes(1);
    haptic('light');
    expect(mockImpact).toHaveBeenLastCalledWith('light');
    haptic('medium');
    expect(mockImpact).toHaveBeenLastCalledWith('medium');
    haptic('success');
    expect(mockNotify).toHaveBeenLastCalledWith('success');
    expect(mockPerform).not.toHaveBeenCalled();
  });
});

describe('Wave 1/2 names stay callable while owner lanes migrate', () => {
  it('tap and tapLight are light, select is selection, celebrate is success', () => {
    setPlatform('android', 34);
    haptic('tap');
    tapLight();
    haptic('select');
    celebrate();
    expect(mockPerform.mock.calls.map((c) => c[0])).toEqual([
      'CONTEXT_CLICK', 'CONTEXT_CLICK', 'SEGMENT_TICK', 'CONFIRM',
    ]);
  });

  it('warning keeps its iOS notification and is REJECT on Android 30+', () => {
    haptic('warning');
    expect(mockNotify).toHaveBeenLastCalledWith('warning');
    setPlatform('android', 30);
    haptic('warning');
    expect(mockPerform).toHaveBeenLastCalledWith('REJECT');
    expect(androidHapticFor('warning', 29)).toBe('LONG_PRESS');
  });
});

describe('robustness', () => {
  it('makes exactly one engine call per haptic', () => {
    for (const os of ['ios', 'android'] as const) {
      setPlatform(os);
      for (const k of KINDS) {
        const before = engineCalls();
        haptic(k);
        expect(engineCalls() - before).toBe(1);
      }
    }
  });

  it('never throws, whether the native module or expo-haptics throws or rejects', async () => {
    setPlatform('android', 34);
    mockPerform.mockImplementation(() => {
      throw new Error('no activity');
    });
    expect(() => haptic('selection')).not.toThrow();
    mockPerform.mockReturnValue(Promise.reject(new Error('detached view')));
    expect(() => haptic('light')).not.toThrow();

    mockNative.current = null;
    mockSelect.mockImplementation(() => {
      throw new Error('no vibrator');
    });
    mockImpact.mockReturnValue(Promise.reject(new Error('no engine')));
    expect(() => haptic('selection')).not.toThrow();
    expect(() => haptic('light')).not.toThrow();

    setPlatform('ios');
    expect(() => tapLight()).not.toThrow();
    // Let the rejected promises settle: an unhandled rejection would fail the run.
    await new Promise((r) => setTimeout(r, 0));
  });
});

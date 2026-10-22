/**
 * The JS face of the local `RoxyHaptics` Expo module (apps/mobile/modules/roxy-haptics).
 * The wrapper in lib/haptics must never crash when the module is missing: web, Expo Go,
 * and every installed Android build older than the module have no `RoxyHaptics`.
 */
import { loadRoxyHaptics } from '../../modules/roxy-haptics';

type ExpoGlobal = { modules?: Record<string, unknown> };
const g = globalThis as unknown as { expo?: ExpoGlobal };

describe('loadRoxyHaptics', () => {
  const savedDescriptor = g.expo ? Object.getOwnPropertyDescriptor(g.expo, 'modules') : undefined;

  afterEach(() => {
    if (!g.expo) return;
    if (savedDescriptor) Object.defineProperty(g.expo, 'modules', savedDescriptor);
    else delete g.expo.modules;
  });

  it('returns null when the native module is not installed (older build, Expo Go, jest)', () => {
    expect(loadRoxyHaptics()).toBeNull();
  });

  it('returns the installed module when the build carries it', () => {
    const native = { perform: jest.fn(async () => true) };
    expect(g.expo).toBeDefined();
    Object.defineProperty(g.expo!, 'modules', {
      value: { ...(g.expo!.modules ?? {}), RoxyHaptics: native },
      configurable: true,
      writable: true,
    });
    expect(loadRoxyHaptics()).toBe(native);
  });

  it('returns null instead of throwing when the module lookup itself throws', () => {
    // The real lookup reads `globalThis.expo.modules[name]`; make that read throw.
    Object.defineProperty(g.expo!, 'modules', {
      get() {
        throw new Error('Unable to install Expo modules');
      },
      configurable: true,
    });
    expect(() => loadRoxyHaptics()).not.toThrow();
    expect(loadRoxyHaptics()).toBeNull();
  });
});

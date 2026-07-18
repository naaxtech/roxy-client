import { Alert, Platform } from 'react-native';
import { confirmAction } from '../lib/confirm';

describe('confirmAction', () => {
  const originalOS = Platform.OS;
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOS });
    jest.restoreAllMocks();
  });

  it('uses window.confirm on web and resolves true when accepted', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'web' });
    (globalThis as any).confirm = jest.fn(() => true);
    await expect(confirmAction('Sign out', 'Are you sure?')).resolves.toBe(true);
    expect((globalThis as any).confirm).toHaveBeenCalledWith('Sign out\n\nAre you sure?');
  });

  it('resolves false on web when dismissed', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'web' });
    (globalThis as any).confirm = jest.fn(() => false);
    await expect(confirmAction('Sign out', 'Are you sure?')).resolves.toBe(false);
  });

  it('uses Alert.alert on native and resolves true on confirm press', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios' });
    const spy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      const confirmBtn = buttons?.find((b) => b.style !== 'cancel');
      confirmBtn?.onPress?.();
    });
    await expect(confirmAction('Sign out', 'Are you sure?', 'Sign out')).resolves.toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  it('resolves false on native when cancelled', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios' });
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      const cancelBtn = buttons?.find((b) => b.style === 'cancel');
      cancelBtn?.onPress?.();
    });
    await expect(confirmAction('Sign out', 'Are you sure?')).resolves.toBe(false);
  });
});

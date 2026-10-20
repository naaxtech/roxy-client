/**
 * Web must never call the native-only getLastNotificationResponseAsync
 * (it threw an uncaught page error on roxy.expo.app). Native keeps the real hook.
 */
const mockNativeHook = jest.fn(() => 'native-response');

jest.mock('expo-notifications', () => ({ useLastNotificationResponse: mockNativeHook }));

function loadFor(os: 'web' | 'ios' | 'android') {
  let mod: typeof import('../../hooks/useLastPushResponse');
  jest.isolateModules(() => {
    jest.doMock('react-native', () => ({ Platform: { OS: os } }));
    mod = require('../../hooks/useLastPushResponse');
  });
  return mod!;
}

beforeEach(() => mockNativeHook.mockClear());

it('web: returns null and never touches the native module', () => {
  const { useLastPushResponse } = loadFor('web');
  expect(useLastPushResponse()).toBeNull();
  expect(mockNativeHook).not.toHaveBeenCalled();
});

it.each(['ios', 'android'] as const)('%s: uses expo-notifications useLastNotificationResponse', (os) => {
  const { useLastPushResponse } = loadFor(os);
  expect(useLastPushResponse).toBe(mockNativeHook);
});

it('the tabs layout reads the tapped push through the web-safe hook', () => {
  const fs = require('fs');
  const path = require('path');
  const src: string = fs.readFileSync(path.join(__dirname, '../../app/(tabs)/_layout.tsx'), 'utf8');
  expect(src).toMatch(/useLastPushResponse\(\)/);
  expect(src).not.toMatch(/Notifications\.useLastNotificationResponse\(/);
});

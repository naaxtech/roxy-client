// Reproduces daily-js's real constraint: ONE call object is supported per
// process, and the factory THROWS if a second is created while the first is
// still alive. That throw is what surfaced to users as the generic
// "Failed to connect to the room. Please try again."
// src: https://docs.daily.co/reference/daily-js/factory-methods/create-call-object · react-native-daily-js 0.83 (daily-js 0.86) · 2026-08-02
jest.mock(
  '@daily-co/react-native-daily-js',
  () => {
    // Declared inside the factory: babel-plugin-jest-hoist rejects any
    // out-of-scope reference, including a type alias. The shape is written
    // inline for the same reason — a named type would be an outer reference.
    let live: { isDestroyed: () => boolean } | null = null;

    const createCallObject = jest.fn(() => {
      if (live && !live.isDestroyed()) {
        throw new Error('Duplicate DailyIframe instances are not allowed');
      }
      let destroyed = false;
      const call = {
        join: jest.fn(async () => ({})),
        leave: jest.fn(async () => undefined),
        destroy: jest.fn(async () => {
          destroyed = true;
          live = null;
        }),
        isDestroyed: () => destroyed,
        on: jest.fn(),
        participants: jest.fn(() => ({ local: { audio: false, video: true } })),
        setLocalAudio: jest.fn(),
        setLocalVideo: jest.fn(),
        updateParticipant: jest.fn(),
      };
      live = call;
      return call;
    });

    return {
      __esModule: true,
      default: {
        createCallObject,
        getCallInstance: () => (live && !live.isDestroyed() ? live : null),
      },
      DailyMediaView: () => null,
      __getLive: () => live,
      __reset: () => {
        live = null;
        createCallObject.mockClear();
      },
    };
  },
  { virtual: true },
);

import { DailyProvider } from '../../lib/video/DailyProvider';

const daily = jest.requireMock('@daily-co/react-native-daily-js');

const ROOM = { roomUrl: 'https://roxy.daily.co/roxy-room-abcd1234', token: 'tok', startAudioOff: true };

describe('DailyProvider — single call object per process', () => {
  beforeEach(() => {
    daily.__reset();
  });

  it('is available when the native module exposes createCallObject', () => {
    expect(new DailyProvider().isAvailable).toBe(true);
  });

  // Regression: re-entering a room reused the same provider and called
  // createCallObject() a second time over a live instance.
  it('joins twice on the same provider without throwing', async () => {
    const provider = new DailyProvider();

    await provider.join(ROOM);
    await expect(provider.join(ROOM)).resolves.toBeUndefined();
  });

  // Regression: a screen that unmounted without a completed teardown left the
  // module-global instance alive, so EVERY later room join failed until the
  // app was restarted — audio and video alike.
  it('reclaims a call object leaked by a previous screen', async () => {
    const abandoned = new DailyProvider();
    await abandoned.join(ROOM);
    expect(daily.__getLive()).not.toBeNull();

    const fresh = new DailyProvider();
    await expect(fresh.join(ROOM)).resolves.toBeUndefined();
  });

  it('waits for an in-flight destroy() before joining again', async () => {
    const provider = new DailyProvider();
    await provider.join(ROOM);
    const first = daily.__getLive();

    // destroy() is fire-and-forget from unmount cleanup — a join issued in the
    // same tick must still sequence behind it.
    provider.destroy();
    await expect(provider.join(ROOM)).resolves.toBeUndefined();

    expect(first.destroy).toHaveBeenCalled();
  });

  it('leaves and destroys without rejecting when the call is already gone', async () => {
    const provider = new DailyProvider();
    await provider.join(ROOM);

    provider.destroy();
    await expect(provider.leave()).resolves.toBeUndefined();
    expect(() => provider.destroy()).not.toThrow();
  });

  it('passes the room url and meeting token through to Daily', async () => {
    const provider = new DailyProvider();
    await provider.join(ROOM);

    expect(daily.__getLive().join).toHaveBeenCalledWith(
      expect.objectContaining({ url: ROOM.roomUrl, token: 'tok', startAudioOff: true }),
    );
  });

  it('omits the token key entirely when no meeting token was issued', async () => {
    const provider = new DailyProvider();
    await provider.join({ roomUrl: ROOM.roomUrl });

    expect(daily.__getLive().join).toHaveBeenCalledWith({ url: ROOM.roomUrl, startAudioOff: false });
  });

  it('reports local media state from the provider, not a client guess', async () => {
    const provider = new DailyProvider();
    await provider.join(ROOM);

    expect(provider.getLocalMediaState()).toEqual({ audio: false, video: true });
  });
});

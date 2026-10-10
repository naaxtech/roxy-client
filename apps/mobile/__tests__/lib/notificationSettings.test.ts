/**
 * Notification settings (lib/notificationSettings.ts) — the data side of the
 * You › Settings › Notifications screen.
 *
 * Nicole's defaults (2026-10-04): every type ON, lock-screen previews OFF.
 * A user who has never opened the screen has no row; reads must return the
 * defaults, and the first save must create the row with her timezone.
 */
import { supabase } from '../../lib/supabase';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  isValidQuietTime,
  loadNotificationSettings,
  saveNotificationSettings,
} from '../../lib/notificationSettings';

jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));

const from = supabase.from as jest.Mock;

function selectReturning(result: { data: unknown; error: unknown }) {
  const chain: Record<string, jest.Mock> = {};
  chain.select = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.maybeSingle = jest.fn(() => Promise.resolve(result));
  return chain;
}

beforeEach(() => jest.clearAllMocks());

describe('defaults', () => {
  it('every type is on, previews are off', () => {
    expect(DEFAULT_NOTIFICATION_SETTINGS).toMatchObject({
      push_enabled: true, messages: true, friends: true, events: true, community_chats: true,
      activity: true, show_previews: false, quiet_start: null, quiet_end: null,
    });
  });
});

describe('loadNotificationSettings', () => {
  it('returns the defaults when she has never saved anything', async () => {
    from.mockReturnValue(selectReturning({ data: null, error: null }));
    await expect(loadNotificationSettings('u1')).resolves.toEqual(DEFAULT_NOTIFICATION_SETTINGS);
    expect(from).toHaveBeenCalledWith('notification_settings');
  });

  it('returns her saved row, trimming seconds off quiet hours', async () => {
    from.mockReturnValue(selectReturning({
      data: {
        user_id: 'u1', push_enabled: true, messages: false, friends: true, events: true,
        community_chats: false, show_previews: true, quiet_start: '22:00:00', quiet_end: '07:00:00',
        timezone: 'Asia/Manila',
      },
      error: null,
    }));
    const s = await loadNotificationSettings('u1');
    expect(s.messages).toBe(false);
    expect(s.show_previews).toBe(true);
    expect(s.quiet_start).toBe('22:00');
    expect(s.quiet_end).toBe('07:00');
  });

  it('reads her activity switch (likes, comments, follows) and asks for the column', async () => {
    const chain = selectReturning({ data: { user_id: 'u1', activity: false }, error: null });
    from.mockReturnValue(chain);
    const s = await loadNotificationSettings('u1');
    expect(s.activity).toBe(false);
    expect(String(chain.select.mock.calls[0][0])).toContain('activity');
  });

  it('a row saved before the activity switch existed reads it as ON', async () => {
    from.mockReturnValue(selectReturning({ data: { user_id: 'u1', messages: true }, error: null }));
    await expect(loadNotificationSettings('u1')).resolves.toMatchObject({ activity: true });
  });

  it('throws when the read fails, so the screen can say so instead of showing wrong switches', async () => {
    from.mockReturnValue(selectReturning({ data: null, error: { message: 'down' } }));
    await expect(loadNotificationSettings('u1')).rejects.toBeTruthy();
  });
});

describe('saveNotificationSettings', () => {
  it('upserts her row with her timezone and a fresh updated_at', async () => {
    const upsert = jest.fn(() => Promise.resolve({ error: null }));
    from.mockReturnValue({ upsert });
    await saveNotificationSettings('u1', { ...DEFAULT_NOTIFICATION_SETTINGS, messages: false }, 'Europe/London');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'u1', messages: false, show_previews: false, timezone: 'Europe/London' }),
      { onConflict: 'user_id' },
    );
    const firstCall = upsert.mock.calls[0] as unknown as [{ updated_at: string }];
    expect(typeof firstCall[0].updated_at).toBe('string');
  });

  it('throws when the write fails, so the switch can roll back', async () => {
    from.mockReturnValue({ upsert: jest.fn(() => Promise.resolve({ error: { message: 'nope' } })) });
    await expect(saveNotificationSettings('u1', DEFAULT_NOTIFICATION_SETTINGS, 'UTC')).rejects.toBeTruthy();
  });

  it('refuses a half-set quiet window', async () => {
    from.mockReturnValue({ upsert: jest.fn() });
    await expect(
      saveNotificationSettings('u1', { ...DEFAULT_NOTIFICATION_SETTINGS, quiet_start: '22:00', quiet_end: null }, 'UTC'),
    ).rejects.toThrow(/quiet hours/i);
  });
});

describe('isValidQuietTime', () => {
  it('accepts HH:MM and rejects the rest', () => {
    expect(isValidQuietTime('00:00')).toBe(true);
    expect(isValidQuietTime('23:59')).toBe(true);
    expect(isValidQuietTime('24:00')).toBe(false);
    expect(isValidQuietTime('7:00')).toBe(false);
    expect(isValidQuietTime('')).toBe(false);
  });
});

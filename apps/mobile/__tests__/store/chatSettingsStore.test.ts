/**
 * Read receipts are a two-way setting: with hers off, the server stops sending
 * hers (mark_conversation_read, migration 132) and she stops seeing others'.
 * The switch is optimistic, and a refused save puts it back — the screen must
 * never show a privacy setting the server did not keep.
 */
jest.mock('../../lib/chat', () => ({
  ...jest.requireActual('../../lib/chat'),
  fetchChatSettings: jest.fn(),
  setChatSettings: jest.fn(),
}));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));

import { useChatSettingsStore, showsReadReceipts } from '../../store/chatSettingsStore';

const chat = jest.requireMock('../../lib/chat');

beforeEach(() => {
  jest.clearAllMocks();
  useChatSettingsStore.getState().reset();
});

it('starts at the defaults (receipts on, friends can add her)', () => {
  const s = useChatSettingsStore.getState();
  expect(s.settings).toEqual({ read_receipts: true, group_add_permission: 'friends' });
  expect(showsReadReceipts(s)).toBe(true);
});

it('loads her saved row', async () => {
  chat.fetchChatSettings.mockResolvedValueOnce({ read_receipts: false, group_add_permission: 'nobody' });
  await useChatSettingsStore.getState().load();
  expect(useChatSettingsStore.getState().settings).toEqual({ read_receipts: false, group_add_permission: 'nobody' });
  expect(useChatSettingsStore.getState().loaded).toBe(true);
});

it('a failed load is remembered, not mistaken for the defaults being saved', async () => {
  chat.fetchChatSettings.mockRejectedValueOnce(new Error('offline'));
  await useChatSettingsStore.getState().load();
  expect(useChatSettingsStore.getState().loadError).toBe(true);
  expect(useChatSettingsStore.getState().loaded).toBe(false);
});

it('turning receipts off saves through set_chat_settings and hides read ticks', async () => {
  chat.setChatSettings.mockResolvedValueOnce({ read_receipts: false, group_add_permission: 'friends' });
  const ok = await useChatSettingsStore.getState().setReadReceipts(false);
  expect(ok).toBe(true);
  expect(chat.setChatSettings).toHaveBeenCalledWith({ readReceipts: false });
  expect(showsReadReceipts(useChatSettingsStore.getState())).toBe(false);
});

it('a refused save rolls the switch back', async () => {
  chat.setChatSettings.mockRejectedValueOnce(new Error('Something went wrong. Please try again.'));
  const ok = await useChatSettingsStore.getState().setReadReceipts(false);
  expect(ok).toBe(false);
  expect(useChatSettingsStore.getState().settings.read_receipts).toBe(true);
  expect(useChatSettingsStore.getState().saving).toBe(false);
});

it('group adds save the same way', async () => {
  chat.setChatSettings.mockResolvedValueOnce({ read_receipts: true, group_add_permission: 'nobody' });
  await useChatSettingsStore.getState().setGroupAddPermission('nobody');
  expect(chat.setChatSettings).toHaveBeenCalledWith({ groupAddPermission: 'nobody' });
  expect(useChatSettingsStore.getState().settings.group_add_permission).toBe('nobody');
});

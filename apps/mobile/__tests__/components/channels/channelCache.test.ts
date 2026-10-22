import {
  CHANNEL_CACHE_MAX, clearChannelCache, readChannelPage, readCommunitySnapshot,
  writeChannelPage, writeCommunitySnapshot,
} from '../../../components/channels/channelCache';

/**
 * F7 memory for the channels screen: in-session only, owner-keyed, bounded,
 * never remembers a provisional (pending) row.
 */
const snap = (name: string) => ({ channels: [], communityName: name, communitySlug: null, isModerator: false });
const row = (id: string) => ({ id, channel_id: 'ch1' }) as never;

beforeEach(() => clearChannelCache());

it('remembers a community and a channel page for the same member only', () => {
  writeCommunitySnapshot('me', 'com1', snap('Book club'));
  writeChannelPage('me', 'ch1', [row('a')]);
  expect(readCommunitySnapshot('me', 'com1')?.communityName).toBe('Book club');
  expect(readChannelPage('me', 'ch1')?.map((m) => m.id)).toEqual(['a']);
  expect(readCommunitySnapshot('other', 'com1')).toBeNull();
  expect(readChannelPage('other', 'ch1')).toBeNull();
});

it('another member signing in wipes the first member\'s memory', () => {
  writeChannelPage('me', 'ch1', [row('a')]);
  writeCommunitySnapshot('other', 'com9', snap('x'));
  expect(readChannelPage('me', 'ch1')).toBeNull();
});

it('never remembers a provisional row, and keeps only the newest page', () => {
  writeChannelPage('me', 'ch1', [row('a'), row('pending:1'), row('b'), row('c')], 2);
  expect(readChannelPage('me', 'ch1')?.map((m) => m.id)).toEqual(['b', 'c']);
});

it(`holds at most ${CHANNEL_CACHE_MAX} pages, dropping the least recently written`, () => {
  for (let i = 0; i <= CHANNEL_CACHE_MAX; i += 1) writeChannelPage('me', `ch${i}`, [row('x')]);
  expect(readChannelPage('me', 'ch0')).toBeNull();
  expect(readChannelPage('me', `ch${CHANNEL_CACHE_MAX}`)).not.toBeNull();
});

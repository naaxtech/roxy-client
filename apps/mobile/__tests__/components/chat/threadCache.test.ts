import {
  clearThreadCache, readThreadPage, writeThreadPage, THREAD_CACHE_MAX_THREADS,
} from '../../../components/chat/threadCache';

/**
 * F7 (motion spec): a second visit to a DM within the session shows the
 * messages in the first frame, no spinner. The memory lives only in this JS
 * session: never persisted (P2: no cache-first for Messages on cold start).
 */
type Row = { id: string; deliveryStatus?: 'sending' | 'sent' | 'failed' };
const rows = (...ids: string[]): Row[] => ids.map((id) => ({ id }));

beforeEach(() => clearThreadCache());

it('remembers the newest page of a thread for the same member', () => {
  writeThreadPage('me', 'c1', rows('a', 'b') as never);
  expect(readThreadPage('me', 'c1')?.map((m) => m.id)).toEqual(['a', 'b']);
  expect(readThreadPage('me', 'c2')).toBeNull();
});

it('never hands one member another member\'s thread, and forgets on a new member', () => {
  writeThreadPage('me', 'c1', rows('a') as never);
  expect(readThreadPage('other', 'c1')).toBeNull();
  writeThreadPage('other', 'c9', rows('z') as never);
  // A different member signed in: the first member's memory is gone.
  expect(readThreadPage('me', 'c1')).toBeNull();
});

it('keeps only server rows: a message still sending or failed is not remembered', () => {
  writeThreadPage('me', 'c1', [
    { id: 'a', deliveryStatus: 'sent' }, { id: 'b', deliveryStatus: 'sending' },
    { id: 'c', deliveryStatus: 'failed' }, { id: 'd' },
  ] as never);
  expect(readThreadPage('me', 'c1')?.map((m) => m.id)).toEqual(['a', 'd']);
});

it('keeps only the newest page of rows', () => {
  const many = Array.from({ length: 80 }, (_, i) => ({ id: `m${i}` }));
  writeThreadPage('me', 'c1', many as never, 30);
  const kept = readThreadPage('me', 'c1') ?? [];
  expect(kept).toHaveLength(30);
  expect(kept[0].id).toBe('m50');
  expect(kept[29].id).toBe('m79');
});

it(`holds at most ${THREAD_CACHE_MAX_THREADS} threads, dropping the least recently written`, () => {
  for (let i = 0; i <= THREAD_CACHE_MAX_THREADS; i += 1) writeThreadPage('me', `c${i}`, rows('x') as never);
  expect(readThreadPage('me', 'c0')).toBeNull();
  expect(readThreadPage('me', `c${THREAD_CACHE_MAX_THREADS}`)).not.toBeNull();
});

it('clearThreadCache forgets everything', () => {
  writeThreadPage('me', 'c1', rows('a') as never);
  clearThreadCache();
  expect(readThreadPage('me', 'c1')).toBeNull();
});

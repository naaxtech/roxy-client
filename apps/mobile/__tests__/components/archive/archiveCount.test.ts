import { fetchArchiveTotal } from '../../../components/archive/archiveCount';

/**
 * Jank audit #4: Discover fetched 200 full Archive rows (`archive_ranked_view`,
 * `select *`) only to print `all.length` — on Fast 4G, alongside every other
 * rail's first request. The rail needs one number.
 */
const mockCalls: { table: string; columns: string; options: unknown }[] = [];
const mockAnswer: { count: number | null; error: unknown } = { count: 214, error: null };

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string, options: unknown) => {
        mockCalls.push({ table, columns, options });
        return Promise.resolve({ data: null, count: mockAnswer.count, error: mockAnswer.error });
      },
    }),
  },
}));
jest.mock('../../../lib/errorLogger', () => ({ logError: jest.fn() }));

beforeEach(() => {
  mockCalls.length = 0;
  mockAnswer.count = 214;
  mockAnswer.error = null;
});

describe('fetchArchiveTotal', () => {
  it('asks for a count and no rows', async () => {
    await expect(fetchArchiveTotal()).resolves.toBe(214);

    expect(mockCalls).toEqual([{
      table: 'archive_ranked_view',
      columns: 'id',
      options: { count: 'exact', head: true },
    }]);
  });

  it('throws when the count fails, so the rail can show its error state', async () => {
    mockAnswer.error = { message: 'boom' };
    mockAnswer.count = null;

    await expect(fetchArchiveTotal()).rejects.toEqual({ message: 'boom' });
  });

  it('reads a missing count as an empty catalogue', async () => {
    mockAnswer.count = null;

    await expect(fetchArchiveTotal()).resolves.toBe(0);
  });
});

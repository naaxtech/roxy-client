import { act, renderHook } from '@testing-library/react-native';
import { useBuildStore } from '../../store/buildStore';

/**
 * A search chip is user input, and it was going straight into a PostgREST
 * filter string.
 *
 * `loadBusinesses` built `name.ilike.%${chip}%,description.ilike.%${chip}%,…`
 * by interpolation. A chip containing a comma reads as the separator BETWEEN
 * clauses, so `"bakery,cafe"` produced a malformed group and silently emptied
 * the directory; a parenthesis closed the group early; and `%` or `_` — the two
 * ILIKE wildcards — matched anything at all, so a chip of `_` returned every
 * business on Roxy. `globalSearch` has escaped these since it was written;
 * this path never did.
 */

const mockOr = jest.fn();

jest.mock('../../lib/supabase', () => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.in = () => chain;
  chain.or = (...args: unknown[]) => { mockOr(...args); return chain; };
  chain.order = () => chain;
  chain.limit = () => Promise.resolve({ data: [], error: null });
  return { supabase: { from: () => chain } };
});

beforeEach(() => {
  mockOr.mockClear();
  useBuildStore.setState({ businesses: [], searchChips: [] });
});

describe('loadBusinesses chip safety', () => {
  it('strips the PostgREST filter delimiters out of a chip', async () => {
    const { result } = renderHook(() => useBuildStore());
    await act(async () => { await result.current.loadBusinesses(['bakery,cafe(x)'], false); });

    const filter = mockOr.mock.calls[0][0] as string;
    expect(filter).not.toMatch(/[()]/);
    // Exactly two commas: the separators between the three column clauses.
    // Any more means the chip contributed one of its own.
    expect(filter.split(',')).toHaveLength(3);
    expect(filter).toContain('name.ilike.%bakerycafex%');
  });

  it('escapes the ILIKE wildcards so a chip of "_" cannot match every business', async () => {
    const { result } = renderHook(() => useBuildStore());
    await act(async () => { await result.current.loadBusinesses(['100%_off'], false); });

    expect(mockOr.mock.calls[0][0]).toContain('name.ilike.%100\\%\\_off%');
  });

  it('drops a chip that is nothing but delimiters rather than querying for everything', async () => {
    const { result } = renderHook(() => useBuildStore());
    await act(async () => { await result.current.loadBusinesses(['((,))', 'bakery'], false); });

    // One surviving chip, so one `.or()` group — not two, and not a group
    // whose pattern is the empty string.
    expect(mockOr).toHaveBeenCalledTimes(1);
    expect(mockOr.mock.calls[0][0]).toContain('%bakery%');
  });

  it('still narrows with every chip she stacked', async () => {
    const { result } = renderHook(() => useBuildStore());
    await act(async () => { await result.current.loadBusinesses(['vegan', 'bakery'], false); });

    expect(mockOr).toHaveBeenCalledTimes(2);
  });
});

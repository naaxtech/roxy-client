import { act, renderHook } from '@testing-library/react-native';
import { useCommunityStore } from '../../store/communityStore';

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: [], error: null }),
    })),
  },
}));

const { supabase } = jest.requireMock('../../lib/supabase');

const makeCommunity = (id: string, name: string) => ({
  id, name, slug: name.toLowerCase(), description: null,
  cover_image_url: null, category: 'general', is_private: false,
  member_count: 10, created_by: 'u1', created_at: new Date().toISOString(),
});

describe('communityStore', () => {
  beforeEach(() => {
    useCommunityStore.setState({ joinedCommunities: [], allCommunities: [], joinedIds: new Set() });
    jest.clearAllMocks();
  });

  it('initialises with empty state', () => {
    const { result } = renderHook(() => useCommunityStore());
    expect(result.current.allCommunities).toEqual([]);
    expect(result.current.joinedCommunities).toEqual([]);
    expect(result.current.joinedIds.size).toBe(0);
  });

  it('fetchAll populates allCommunities', async () => {
    const communities = [makeCommunity('c1', 'WLW Hikers'), makeCommunity('c2', 'Queer Gamers')];
    supabase.from.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: communities, error: null }),
    });

    const { result } = renderHook(() => useCommunityStore());
    await act(async () => { await result.current.fetchAll(); });

    expect(result.current.allCommunities).toHaveLength(2);
    expect(result.current.allCommunities[0].name).toBe('WLW Hikers');
  });

  it('fetchJoined populates joinedCommunities and joinedIds', async () => {
    const community = makeCommunity('c1', 'WLW Hikers');
    supabase.from.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ data: [{ communities: community }], error: null }),
    });

    const { result } = renderHook(() => useCommunityStore());
    await act(async () => { await result.current.fetchJoined('user-1'); });

    expect(result.current.joinedCommunities).toHaveLength(1);
    expect(result.current.joinedIds.has('c1')).toBe(true);
  });

  it('joinCommunity adds community to joined state', async () => {
    const community = makeCommunity('c1', 'WLW Hikers');
    useCommunityStore.setState({ allCommunities: [community], joinedCommunities: [], joinedIds: new Set() });

    supabase.from.mockReturnValue({
      upsert: jest.fn().mockResolvedValue({ error: null }),
    });

    const { result } = renderHook(() => useCommunityStore());
    await act(async () => { await result.current.joinCommunity('c1', 'user-1'); });

    expect(result.current.joinedIds.has('c1')).toBe(true);
    expect(result.current.joinedCommunities).toHaveLength(1);
  });

  it('leaveCommunity removes community from joined state', async () => {
    const community = makeCommunity('c1', 'WLW Hikers');
    useCommunityStore.setState({
      allCommunities: [community],
      joinedCommunities: [community],
      joinedIds: new Set(['c1']),
    });

    const eqChain: any = { eq: jest.fn() };
    eqChain.eq.mockReturnValueOnce(eqChain).mockResolvedValueOnce({ error: null });
    supabase.from.mockReturnValue({ delete: jest.fn().mockReturnValue(eqChain) });

    const { result } = renderHook(() => useCommunityStore());
    await act(async () => { await result.current.leaveCommunity('c1', 'user-1'); });

    expect(result.current.joinedIds.has('c1')).toBe(false);
    expect(result.current.joinedCommunities).toHaveLength(0);
  });

  it('fetchAll handles empty data gracefully', async () => {
    supabase.from.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: null, error: null }),
    });

    const { result } = renderHook(() => useCommunityStore());
    await act(async () => { await result.current.fetchAll(); });

    expect(result.current.allCommunities).toEqual([]);
  });
});

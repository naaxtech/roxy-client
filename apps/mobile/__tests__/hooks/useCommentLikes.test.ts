import { act, renderHook } from '@testing-library/react-native';

const mockToggle = jest.fn();
jest.mock('../../lib/comments', () => ({
  toggleCommentLike: (...a: unknown[]) => mockToggle(...a),
}));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));
jest.mock('../../lib/haptics', () => ({ tapLight: jest.fn() }));

import { useCommentLikes } from '../../hooks/useCommentLikes';

beforeEach(() => mockToggle.mockReset());

describe('useCommentLikes', () => {
  it('lights the heart at once and keeps it when the write lands', async () => {
    mockToggle.mockResolvedValue({ error: null });
    const { result } = renderHook(() => useCommentLikes('me'));
    let ok = false;
    await act(async () => { ok = await result.current.toggle('c1'); });
    expect(ok).toBe(true);
    expect(result.current.likedIds.has('c1')).toBe(true);
    expect(mockToggle).toHaveBeenCalledWith({ commentId: 'c1', userId: 'me', liked: false });
  });

  it('rolls the like back when the write is refused', async () => {
    mockToggle.mockResolvedValue({ error: 'permission denied' });
    const { result } = renderHook(() => useCommentLikes('me'));
    await act(async () => { await result.current.toggle('c1'); });
    expect(result.current.likedIds.has('c1')).toBe(false);
  });

  it('rolls an unlike back too', async () => {
    mockToggle.mockResolvedValue({ error: 'offline' });
    const { result } = renderHook(() => useCommentLikes('me'));
    act(() => { result.current.setLikedIds(new Set(['c1'])); });
    await act(async () => { await result.current.toggle('c1'); });
    expect(result.current.likedIds.has('c1')).toBe(true);
    expect(mockToggle).toHaveBeenCalledWith({ commentId: 'c1', userId: 'me', liked: true });
  });

  it('ignores a second tap while the first write is in flight', async () => {
    let release: (v: { error: null }) => void = () => undefined;
    mockToggle.mockImplementation(() => new Promise((r) => { release = r; }));
    const { result } = renderHook(() => useCommentLikes('me'));
    let first: Promise<boolean> = Promise.resolve(false);
    act(() => { first = result.current.toggle('c1'); });
    await act(async () => { await result.current.toggle('c1'); });
    expect(mockToggle).toHaveBeenCalledTimes(1);
    await act(async () => { release({ error: null }); await first; });
    expect(result.current.likedIds.has('c1')).toBe(true);
  });

  it('does nothing signed out', async () => {
    const { result } = renderHook(() => useCommentLikes(''));
    await act(async () => { await result.current.toggle('c1'); });
    expect(mockToggle).not.toHaveBeenCalled();
  });
});

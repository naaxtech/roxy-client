// jest.mock() MUST be first — before any imports (Babel hoisting requirement)
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      update: jest.fn(() => ({
        eq: jest.fn(() => ({ error: null })),
      })),
    })),
  },
  callEdgeFunction: jest.fn(),
}));

import { renderHook, act } from '@testing-library/react-native';
import { useProfileStore } from '../../store/profileStore';

beforeEach(() => {
  useProfileStore.setState({
    profile: { id: 'u1', display_name: 'Alice', bio: '' } as any,
  });
  jest.clearAllMocks();
});

it('updateProfile merges patch into local profile state', async () => {
  const { result } = renderHook(() => useProfileStore());
  await act(async () => { await result.current.updateProfile({ bio: 'Hello world' }); });
  expect(result.current.profile?.bio).toBe('Hello world');
});

it('updateProfile calls supabase update on profiles table', async () => {
  const { result } = renderHook(() => useProfileStore());
  await act(async () => { await result.current.updateProfile({ display_name: 'Bob' }); });
  const { supabase } = jest.requireMock('../../lib/supabase');
  expect(supabase.from).toHaveBeenCalledWith('profiles');
});

it('updateProfile throws when supabase returns error', async () => {
  const { supabase } = jest.requireMock('../../lib/supabase');
  supabase.from.mockReturnValueOnce({
    update: jest.fn(() => ({ eq: jest.fn(() => ({ error: { message: 'DB error' } })) })),
  });
  const { result } = renderHook(() => useProfileStore());
  await expect(
    act(async () => { await result.current.updateProfile({ bio: 'x' }); })
  ).rejects.toThrow('DB error');
});

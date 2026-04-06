import { act, renderHook } from '@testing-library/react-native';
import { useCommunityFilterStore } from '../../store/communityFilterStore';

describe('communityFilterStore', () => {
  beforeEach(() => {
    useCommunityFilterStore.setState({ selectedCommunityId: null });
  });

  it('initialises with null selection', () => {
    const { result } = renderHook(() => useCommunityFilterStore());
    expect(result.current.selectedCommunityId).toBeNull();
  });

  it('setSelectedCommunity stores the id', () => {
    const { result } = renderHook(() => useCommunityFilterStore());
    act(() => { result.current.setSelectedCommunity('abc-123'); });
    expect(result.current.selectedCommunityId).toBe('abc-123');
  });

  it('setSelectedCommunity(null) resets to All Communities', () => {
    useCommunityFilterStore.setState({ selectedCommunityId: 'abc-123' });
    const { result } = renderHook(() => useCommunityFilterStore());
    act(() => { result.current.setSelectedCommunity(null); });
    expect(result.current.selectedCommunityId).toBeNull();
  });
});

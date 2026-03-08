jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
  },
  callEdgeFunction: jest.fn(),
}));

import { act, renderHook } from '@testing-library/react-native';
import { useSafetyStore } from '../../store/safetyStore';

beforeEach(() => {
  useSafetyStore.setState({
    blockedUserIds: [],
    isReportModalOpen: false,
    reportTarget: null,
  });
  jest.clearAllMocks();
});

describe('safetyStore', () => {
  it('blockUser adds userId to blockedUserIds', async () => {
    const { supabase } = jest.requireMock('../../lib/supabase');
    supabase.rpc.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useSafetyStore());
    await act(async () => {
      await result.current.blockUser('user-123');
    });

    expect(result.current.blockedUserIds).toContain('user-123');
  });

  it('blockUser deduplicates — calling twice yields one entry', async () => {
    const { supabase } = jest.requireMock('../../lib/supabase');
    supabase.rpc.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useSafetyStore());
    await act(async () => {
      await result.current.blockUser('user-abc');
    });
    await act(async () => {
      await result.current.blockUser('user-abc');
    });

    expect(result.current.blockedUserIds.length).toBe(1);
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });

  it('openReportModal sets target and opens modal', () => {
    const { result } = renderHook(() => useSafetyStore());
    act(() => {
      result.current.openReportModal({ userId: 'u1', contentType: 'message', contentId: 'msg-1' });
    });

    expect(result.current.isReportModalOpen).toBe(true);
    expect(result.current.reportTarget?.userId).toBe('u1');
  });

  it('closeReportModal resets state', () => {
    const { result } = renderHook(() => useSafetyStore());
    act(() => {
      result.current.openReportModal({ userId: 'u1', contentType: 'message', contentId: 'msg-1' });
    });
    act(() => {
      result.current.closeReportModal();
    });

    expect(result.current.isReportModalOpen).toBe(false);
    expect(result.current.reportTarget).toBeNull();
  });

  it('submitReport calls callEdgeFunction and closes modal', async () => {
    const { callEdgeFunction } = jest.requireMock('../../lib/supabase');
    callEdgeFunction.mockResolvedValue({ ok: true });

    const { result } = renderHook(() => useSafetyStore());
    act(() => {
      result.current.openReportModal({ userId: 'u2', contentType: 'profile' });
    });

    await act(async () => {
      await result.current.submitReport('spam');
    });

    expect(callEdgeFunction).toHaveBeenCalledWith('submit-report', {
      userId: 'u2',
      contentType: 'profile',
      contentId: undefined,
      reason: 'spam',
      detail: undefined,
    });
    expect(result.current.isReportModalOpen).toBe(false);
  });
});

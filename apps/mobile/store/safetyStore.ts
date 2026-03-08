import { create } from 'zustand';
import { supabase, callEdgeFunction } from '../lib/supabase';

interface SafetyState {
  // Blocking
  blockedUserIds: string[];
  blockUser: (targetUserId: string) => Promise<void>;

  // Reporting
  isReportModalOpen: boolean;
  reportTarget: {
    userId: string;
    contentType: 'message' | 'post' | 'profile';
    contentId?: string;
  } | null;
  openReportModal: (target: SafetyState['reportTarget']) => void;
  closeReportModal: () => void;
  submitReport: (
    reason: 'harassment' | 'spam' | 'inappropriate' | 'hate_speech' | 'other',
    detail?: string
  ) => Promise<void>;
}

export const useSafetyStore = create<SafetyState>((set, get) => ({
  blockedUserIds: [],
  isReportModalOpen: false,
  reportTarget: null,

  blockUser: async (targetUserId) => {
    if (get().blockedUserIds.includes(targetUserId)) return;
    const { error } = await supabase.rpc('block_user', { target_id: targetUserId });
    if (error) throw error;
    set((s) => ({ blockedUserIds: [...s.blockedUserIds, targetUserId] }));
  },

  openReportModal: (target) => set({ reportTarget: target, isReportModalOpen: true }),

  closeReportModal: () => set({ isReportModalOpen: false, reportTarget: null }),

  submitReport: async (reason, detail) => {
    const { reportTarget } = get();
    if (!reportTarget) throw new Error('No report target');
    // Modal stays open on failure so the user can retry
    await callEdgeFunction('submit-report', {
      userId: reportTarget.userId,
      contentType: reportTarget.contentType,
      contentId: reportTarget.contentId,
      reason,
      detail,
    });
    get().closeReportModal();
  },
}));

import { create } from 'zustand';
import { supabase, callEdgeFunction } from '../lib/supabase';
import { logError } from '../lib/errorLogger';

interface SafetyState {
  // Blocking
  blockedUserIds: string[];
  loadingBlocks: boolean;
  blockLoadError: boolean;
  loadBlockedUsers: () => Promise<void>;
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
  loadingBlocks: false,
  blockLoadError: false,
  isReportModalOpen: false,
  reportTarget: null,

  /**
   * Rehydrate the block list from the server.
   *
   * blockedUserIds is the guard blockUser() checks before doing any work, and
   * it used to start empty on every launch with nothing ever refilling it — so
   * the app forgot who a woman had blocked the moment she closed it. The rows
   * themselves are readable under friendships_own, but blocks being *stored*
   * as friendships is this schema's private business; blocked_user_ids()
   * (migration 085) is the contract the client is allowed to know about.
   */
  loadBlockedUsers: async () => {
    set({ loadingBlocks: true, blockLoadError: false });
    const { data, error } = await supabase.rpc('blocked_user_ids');
    if (error) {
      logError(error, 'safetyStore.loadBlockedUsers');
      // Deliberately does NOT clear blockedUserIds: a failed refresh must never
      // silently un-block someone she has already blocked this session.
      set({ loadingBlocks: false, blockLoadError: true });
      return;
    }
    set({
      blockedUserIds: ((data as string[] | null) ?? []),
      loadingBlocks: false,
      blockLoadError: false,
    });
  },

  blockUser: async (targetUserId) => {
    if (get().blockedUserIds.includes(targetUserId)) return;
    // p_target_id, not target_id: this called a function that did not exist in
    // any migration until 085, so every block returned PGRST202 and the chat
    // menu reported "Could not block user."
    const { error } = await supabase.rpc('block_user', { p_target_id: targetUserId });
    if (error) throw error;
    set((s) => ({ blockedUserIds: [...s.blockedUserIds, targetUserId] }));
  },

  openReportModal: (target) => set({ reportTarget: target, isReportModalOpen: true }),

  closeReportModal: () => set({ isReportModalOpen: false, reportTarget: null }),

  submitReport: async (reason, detail) => {
    const { reportTarget } = get();
    if (!reportTarget) throw new Error('No report target');

    // `callEdgeFunction` CATCHES and returns `{ data, error }` — it never throws
    // (lib/supabase.ts:23-26). This function used to await it, discard the
    // envelope, and close the modal, so a refused write resolved exactly like an
    // accepted one. Every caller wraps this in try/catch and announces success
    // when it does not reject: connect/chat/[id].tsx:602 showed "Report
    // submitted. Thank you for keeping our community safe 💜" over a report that
    // did not exist. On a safety product that is worse than no report button —
    // she stops looking for another way to be heard.
    //
    // Reading the envelope and throwing is what the comment below always
    // claimed, and what the callers were already written for.
    const { error } = await callEdgeFunction('submit-report', {
      userId: reportTarget.userId,
      contentType: reportTarget.contentType,
      contentId: reportTarget.contentId,
      reason,
      detail,
    });

    // Modal stays open on failure so the user can retry.
    if (error) throw new Error(error);

    get().closeReportModal();
  },
}));

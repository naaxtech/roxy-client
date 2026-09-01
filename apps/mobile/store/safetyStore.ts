import { create } from 'zustand';
import { supabase, callEdgeFunction } from '../lib/supabase';
import { logError } from '../lib/errorLogger';

/** Enough of a blocked member to render a row she can recognise and undo. */
export type BlockedProfile = {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
};

interface SafetyState {
  // Blocking
  blockedUserIds: string[];
  /**
   * The same block list with names attached, from the `blocked_profiles()`
   * function migration 093 adds. `blockedUserIds` answers "is he blocked" on
   * every render of every feed and stays a bare array of ids for that reason;
   * this one exists only for the Blocked screen.
   */
  blockedProfiles: BlockedProfile[];
  loadingBlocks: boolean;
  blockLoadError: boolean;
  loadBlockedUsers: () => Promise<void>;
  loadBlockedProfiles: () => Promise<void>;
  blockUser: (targetUserId: string) => Promise<void>;
  /**
   * Returns whether a row was actually removed.
   *
   * A PostgREST write answers 200 for a statement that matched nothing, so the
   * absence of an error is not evidence that she is unblocked. `unblock_user`
   * returns its affected-row count and this returns it as a boolean, so the
   * screen can tell an undo from a no-op instead of assuming.
   */
  unblockUser: (targetUserId: string) => Promise<boolean>;

  // Reporting
  isReportModalOpen: boolean;
  reportTarget: {
    userId: string;
    /**
     * Where the thing being reported happened.
     *
     * `room` and `speed_date` were added when live surfaces got report buttons.
     * Reporting a live video date as though it were a `profile` throws away the
     * one detail a moderator needs to find it — which session, at what time —
     * and a report a moderator cannot act on is a report that did not happen.
     *
     * NOTE: `supabase/functions/submit-report` must accept these two before the
     * live surfaces are shipped to production; until then the edge function is
     * the narrower contract. Tracked in docs/sessions/2026-08-16-roxy-3.0.md.
     */
    contentType: 'message' | 'post' | 'profile' | 'room' | 'speed_date';
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
  blockedProfiles: [],
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

  /**
   * The block list with names, for the Blocked screen.
   *
   * Same rule as `loadBlockedUsers` above and for the same reason: a failed
   * refresh must never look like "you have not blocked anyone". It sets the
   * error flag and leaves what it already had.
   */
  loadBlockedProfiles: async () => {
    set({ loadingBlocks: true, blockLoadError: false });
    const { data, error } = await supabase.rpc('blocked_profiles');
    if (error) {
      logError(error, 'safetyStore.loadBlockedProfiles');
      set({ loadingBlocks: false, blockLoadError: true });
      return;
    }
    set({
      blockedProfiles: (data as BlockedProfile[] | null) ?? [],
      loadingBlocks: false,
      blockLoadError: false,
    });
  },

  unblockUser: async (targetUserId) => {
    const { data, error } = await supabase.rpc('unblock_user', { p_target_id: targetUserId });
    if (error) {
      logError(error, 'safetyStore.unblockUser');
      return false;
    }

    // The count, not the absence of an error. Zero rows means she is still
    // blocked — showing her removed from the list would be the app reporting a
    // safety change that did not happen, in the direction that matters most.
    const removed = typeof data === 'number' ? data : 0;
    if (removed === 0) return false;

    set((s) => ({
      blockedUserIds: s.blockedUserIds.filter((id) => id !== targetUserId),
      blockedProfiles: s.blockedProfiles.filter((p) => p.id !== targetUserId),
    }));
    return true;
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

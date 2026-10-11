import { create } from 'zustand';
import { Conversation } from '../types';
import {
  EMPTY_BADGE,
  badgeTotal,
  fetchInbox,
  fetchMessagesBadge,
  markConversationRead,
  type InboxThread,
  type MessagesBadge,
} from '../lib/chat';
import { logError } from '../lib/errorLogger';

/**
 * The Messages inbox and its badge — owned by the SERVER (CHAT-13).
 *
 * Unread used to have three owners: the tab layout incremented on every
 * realtime insert, the inbox recomputed from `is_read`, and the chat screen
 * cleared locally. They drifted (double counts while the inbox was open, a
 * badge that never cleared on another device). Now `refresh()` asks
 * `inbox_summary()` + `messages_badge()` and REPLACES what is here. Realtime
 * events only trigger a refresh; nothing on the phone ever increments.
 */
interface ConnectState {
  /** Legacy list some screens still read (participants of direct threads). */
  conversations: Conversation[];
  activeConversationId: string | null;
  /** Per-thread unread, from the server. */
  unreadCounts: Record<string, number>;
  /** Direct + group threads she is active in, newest first. */
  threads: InboxThread[];
  /** Message requests waiting on HER answer. */
  requests: InboxThread[];
  badge: MessagesBadge;
  badgeTotal: number;
  loaded: boolean;
  loading: boolean;
  error: boolean;

  setConversations: (convs: Conversation[]) => void;
  upsertConversation: (conv: Conversation) => void;
  setActiveConversation: (id: string | null) => void;
  /** Kept for older callers. The badge itself only changes through refresh(). */
  incrementUnread: (conversationId: string) => void;
  /** Zero one thread locally (optimistic); refresh() reconciles. */
  clearUnread: (conversationId: string) => void;
  refresh: () => Promise<void>;
  /** Move her read cursor server-side, then refresh. */
  markRead: (conversationId: string) => Promise<void>;
  reset: () => void;
}

const INITIAL = {
  conversations: [] as Conversation[],
  activeConversationId: null as string | null,
  unreadCounts: {} as Record<string, number>,
  threads: [] as InboxThread[],
  requests: [] as InboxThread[],
  badge: EMPTY_BADGE,
  badgeTotal: 0,
  loaded: false,
  loading: false,
  error: false,
};

let inflight: Promise<void> | null = null;
let queued = false;

export const useConnectStore = create<ConnectState>((set, get) => ({
  ...INITIAL,

  setConversations: (conversations) => set({ conversations }),

  upsertConversation: (conv) =>
    set((s) => {
      const idx = s.conversations.findIndex((c) => c.id === conv.id);
      if (idx === -1) {
        return { conversations: [conv, ...s.conversations] };
      }
      const updated = [...s.conversations];
      updated[idx] = conv;
      return { conversations: updated };
    }),

  setActiveConversation: (activeConversationId) => set({ activeConversationId }),

  incrementUnread: (conversationId) =>
    set((s) => ({
      unreadCounts: {
        ...s.unreadCounts,
        [conversationId]: (s.unreadCounts[conversationId] ?? 0) + 1,
      },
    })),

  clearUnread: (conversationId) =>
    set((s) => ({
      unreadCounts: { ...s.unreadCounts, [conversationId]: 0 },
      threads: s.threads.map((t) => (t.conversation_id === conversationId ? { ...t, unread: 0 } : t)),
    })),

  refresh: async () => {
    // Coalesce: a burst of realtime nudges becomes at most one more round trip.
    if (inflight) {
      queued = true;
      return inflight;
    }
    const run = async () => {
      set({ loading: true });
      try {
        const [rows, badge] = await Promise.all([fetchInbox(), fetchMessagesBadge()]);
        const threads = rows.filter((r) => r.my_status === 'active');
        const requests = rows.filter((r) => r.my_status === 'request');
        const unreadCounts: Record<string, number> = {};
        for (const r of rows) unreadCounts[r.conversation_id] = r.unread;
        set({
          threads,
          requests,
          unreadCounts,
          badge,
          badgeTotal: badgeTotal(badge),
          loaded: true,
          loading: false,
          error: false,
        });
      } catch (e) {
        logError(e, 'connectStore.refresh');
        set({ loading: false, error: true });
      }
    };
    inflight = run().finally(() => { inflight = null; });
    await inflight;
    if (queued) {
      queued = false;
      await get().refresh();
    }
  },

  markRead: async (conversationId) => {
    get().clearUnread(conversationId);
    try {
      await markConversationRead(conversationId);
    } catch (e) {
      // Not worth interrupting her reading for; the server keeps its count
      // and the next refresh shows the truth.
      logError(e, 'connectStore.markRead');
    }
    await get().refresh();
  },

  reset: () => {
    inflight = null;
    queued = false;
    set({ ...INITIAL });
  },
}));

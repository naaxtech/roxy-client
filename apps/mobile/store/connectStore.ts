import { create } from 'zustand';
import { Conversation } from '../types';

interface ConnectState {
  conversations: Conversation[];
  activeConversationId: string | null;
  unreadCounts: Record<string, number>;
  setConversations: (convs: Conversation[]) => void;
  upsertConversation: (conv: Conversation) => void;
  setActiveConversation: (id: string | null) => void;
  incrementUnread: (conversationId: string) => void;
  clearUnread: (conversationId: string) => void;
}

export const useConnectStore = create<ConnectState>((set) => ({
  conversations: [],
  activeConversationId: null,
  unreadCounts: {},

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
    })),
}));

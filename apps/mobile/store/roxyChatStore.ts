import { create } from 'zustand';

export interface ChatMessage {
  id: string;
  role: 'user' | 'roxy';
  content: string;
  timestamp: string;
}

interface RoxyChatState {
  messages: ChatMessage[];
  isOpen: boolean;
  isTyping: boolean;
  addMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  setOpen: (open: boolean) => void;
  setTyping: (typing: boolean) => void;
  clear: () => void;
}

export const useRoxyChatStore = create<RoxyChatState>((set) => ({
  messages: [],
  isOpen: false,
  isTyping: false,
  addMessage: (msg) =>
    set((s) => ({
      messages: [
        ...s.messages,
        {
          ...msg,
          id: Date.now().toString(),
          timestamp: new Date().toISOString(),
        },
      ],
    })),
  setOpen: (isOpen) => set({ isOpen }),
  setTyping: (isTyping) => set({ isTyping }),
  clear: () => set({ messages: [] }),
}));

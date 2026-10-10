import { create } from 'zustand';
import {
  fetchChatSettings, setChatSettings, DEFAULT_CHAT_SETTINGS, type ChatSettings,
} from '../lib/chat';
import { logError } from '../lib/errorLogger';

/**
 * Her chat privacy settings (migration 132's chat_settings row), loaded once
 * per session and shared by every surface that draws by them.
 *
 * Read receipts are reciprocal: with hers off, the server stops sending her
 * receipts (mark_conversation_read) and the ticks on her own messages stop
 * turning into "Read" — so the switch never lets her see what she won't show.
 */
interface ChatSettingsState {
  settings: ChatSettings;
  loaded: boolean;
  loadError: boolean;
  saving: boolean;
  load: () => Promise<void>;
  /** Optimistic; rolls back and returns false when the server refused. */
  setReadReceipts: (on: boolean) => Promise<boolean>;
  setGroupAddPermission: (p: ChatSettings['group_add_permission']) => Promise<boolean>;
  reset: () => void;
}

export const useChatSettingsStore = create<ChatSettingsState>((set, get) => {
  const save = async (patch: Partial<ChatSettings>, rpcPatch: Parameters<typeof setChatSettings>[0]) => {
    const before = get().settings;
    set({ settings: { ...before, ...patch }, saving: true });
    try {
      const saved = await setChatSettings(rpcPatch);
      set({ settings: { ...DEFAULT_CHAT_SETTINGS, ...(saved ?? {}), ...patch }, saving: false, loaded: true });
      return true;
    } catch (e) {
      logError(e, 'chatSettings.save');
      set({ settings: before, saving: false });
      return false;
    }
  };

  return {
    settings: DEFAULT_CHAT_SETTINGS,
    loaded: false,
    loadError: false,
    saving: false,

    load: async () => {
      try {
        const settings = await fetchChatSettings();
        set({ settings, loaded: true, loadError: false });
      } catch (e) {
        logError(e, 'chatSettings.load');
        set({ loadError: true });
      }
    },

    setReadReceipts: (on) => save({ read_receipts: on }, { readReceipts: on }),
    setGroupAddPermission: (p) => save({ group_add_permission: p }, { groupAddPermission: p }),

    reset: () => set({ settings: DEFAULT_CHAT_SETTINGS, loaded: false, loadError: false, saving: false }),
  };
});

/** What a tick may say: "Read" only when she shares her own receipts. */
export function showsReadReceipts(s: Pick<ChatSettingsState, 'settings'>): boolean {
  return s.settings.read_receipts;
}

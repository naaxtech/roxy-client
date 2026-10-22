import { create } from 'zustand';
import { Session, User } from '@supabase/supabase-js';
import { clearThreadCache } from '../components/chat/threadCache';
import { clearChannelCache } from '../components/channels/channelCache';
import { clearEventCache } from '../components/events/eventCache';
import { clearCache } from '../lib/cacheFirst';

/**
 * The in-session memory behind F7's instant revisits (DMs, channels, events) is
 * hers alone and never outlives her session (decision P2): it is dropped the
 * moment no one is signed in, not only when the next member signs in.
 */
function forgetSessionMemory(): void {
  clearThreadCache();
  clearChannelCache();
  clearEventCache();
}

/**
 * Her cache-first copies on disk (lib/cacheFirst: Feed page 1, Discover rails,
 * her own profile) go when her session does (P2; lane B's request, applied at
 * the Wave 3 merge). Keyed by her id, so the id is read BEFORE the store
 * forgets her. Fire-and-forget: storage trouble never blocks a sign-out.
 */
function forgetCacheOf(userId: string | null | undefined): void {
  if (!userId) return;
  void clearCache(userId).catch(() => undefined);
}

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  setSession: (session: Session | null) => void;
  setLoading: (loading: boolean) => void;
  signOut: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  loading: true,
  setSession: (session) => {
    const prevId = get().user?.id;
    if (!session?.user) forgetSessionMemory();
    if (prevId && prevId !== session?.user?.id) forgetCacheOf(prevId);
    set({ session, user: session?.user ?? null, loading: false });
  },
  setLoading: (loading) => set({ loading }),
  signOut: () => {
    const prevId = get().user?.id;
    forgetSessionMemory();
    forgetCacheOf(prevId);
    set({ user: null, session: null, loading: false });
  },
}));

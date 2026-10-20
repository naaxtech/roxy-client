import { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { freshChannel } from '../lib/realtimeChannel';
import { logError } from '../lib/errorLogger';
import { useAuthStore } from '../store/authStore';
import { useProfileStore } from '../store/profileStore';
import type { Profile } from '../types';

/** Realtime nudges arriving inside this window cost one read, not one each. */
export const VETTING_NUDGE_COALESCE_MS = 250;

/**
 * Keeps a waiting applicant's own profile fresh (G-11).
 *
 * A decision used to reach her only on a cold start: nothing refetched her
 * profile while the app was open, so an approved woman kept seeing "pending"
 * until she happened to kill the app. Two triggers now, either sufficient:
 *
 *  - realtime on her own membership_applications row (published in 130).
 *    Realtime filters payload columns by column grant, so the event is only
 *    a nudge — the row itself is re-read through `my_profile`.
 *  - the app coming back to the foreground, for when the socket slept. The
 *    channel is rebuilt then too, through `freshChannel`: every subscription
 *    gets its own topic, so a resubscribe can never be handed the cached
 *    channel that is still closing (CHAT-08's deaf-screen bug).
 *
 * `onDecision(prev, next)` fires once when vetting_status changes, so the
 * screen can celebrate the moment rather than just re-render.
 *
 * `enabled` lets a host that is mounted for everyone (the tabs) listen only
 * while she is actually waiting.
 */
export function useVettingStatusSync(
  onDecision?: (previous: string | null, next: string) => void,
  options: { enabled?: boolean } = {},
): { refresh: () => Promise<void> } {
  const enabled = options.enabled ?? true;
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const setProfile = useProfileStore((s) => s.setProfile);
  const last = useRef<string | null>(useProfileStore.getState().profile?.vetting_status ?? null);
  const onDecisionRef = useRef(onDecision);
  onDecisionRef.current = onDecision;

  const refresh = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from('my_profile')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      logError(error, 'useVettingStatusSync.refresh');
      return;
    }
    if (!data) return;
    const next = (data as Profile).vetting_status;
    const previous = last.current;
    last.current = next;
    setProfile(data as Profile);
    if (previous !== null && previous !== next) onDecisionRef.current?.(previous, next);
  }, [userId, setProfile]);

  useEffect(() => {
    if (!userId || !enabled) return;
    let channel: RealtimeChannel | null = null;
    let nudgeTimer: ReturnType<typeof setTimeout> | null = null;
    let alive = true;

    const nudge = () => {
      if (nudgeTimer) return;
      nudgeTimer = setTimeout(() => {
        nudgeTimer = null;
        if (alive) void refresh();
      }, VETTING_NUDGE_COALESCE_MS);
    };

    const subscribe = () => {
      if (channel) void Promise.resolve(supabase.removeChannel(channel)).catch(() => undefined);
      channel = freshChannel(`vetting:${userId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'membership_applications',
            filter: `auth_user_id=eq.${userId}`,
          },
          nudge,
        )
        .subscribe();
    };

    void refresh();
    subscribe();

    const onAppState = (state: AppStateStatus) => {
      if (state !== 'active' || !alive) return;
      void refresh();
      subscribe();
    };
    const sub = AppState.addEventListener('change', onAppState);

    return () => {
      alive = false;
      if (nudgeTimer) clearTimeout(nudgeTimer);
      sub.remove();
      if (channel) void Promise.resolve(supabase.removeChannel(channel)).catch(() => undefined);
      channel = null;
    };
  }, [userId, enabled, refresh]);

  return { refresh };
}

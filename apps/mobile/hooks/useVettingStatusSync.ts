import { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { supabase } from '../lib/supabase';
import { logError } from '../lib/errorLogger';
import { useAuthStore } from '../store/authStore';
import { useProfileStore } from '../store/profileStore';
import type { Profile } from '../types';

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
 *  - the app coming back to the foreground, for when the socket slept.
 *
 * `onDecision(prev, next)` fires once when vetting_status changes, so the
 * screen can celebrate the moment rather than just re-render.
 */
export function useVettingStatusSync(
  onDecision?: (previous: string | null, next: string) => void,
): { refresh: () => Promise<void> } {
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
    if (!userId) return;
    void refresh();

    const channel = supabase
      .channel(`vetting:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'membership_applications',
          filter: `auth_user_id=eq.${userId}`,
        },
        () => { void refresh(); },
      )
      .subscribe();

    const onAppState = (state: AppStateStatus) => {
      if (state === 'active') void refresh();
    };
    const sub = AppState.addEventListener('change', onAppState);

    return () => {
      sub.remove();
      void supabase.removeChannel(channel);
    };
  }, [userId, refresh]);

  return { refresh };
}

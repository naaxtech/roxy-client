import { useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import type { AppStateStatus } from 'react-native';
import { NavigationContext } from '@react-navigation/native';

/**
 * Whether the screen this hook is rendered in may play sound and video now.
 *
 * False when the screen is blurred (another tab, or a profile/post pushed on
 * top of it) or when the app is not in the foreground. Tabs keep their screens
 * mounted, so without this a video kept playing, with sound if unmuted, behind
 * Messages or a profile (FEED-03).
 *
 * Reads the navigation object through the context, not `useIsFocused()`: that
 * hook throws outside a navigator, and this one renders in tests and in
 * previews without one. With no navigator it reports focused.
 */
export function usePlaybackAllowed(): boolean {
  const navigation = useContext(NavigationContext);
  const [focused, setFocused] = useState<boolean>(() => navigation?.isFocused?.() ?? true);
  const [foreground, setForeground] = useState<boolean>(
    () => (AppState.currentState ?? 'active') === 'active',
  );

  useEffect(() => {
    if (!navigation) return undefined;
    setFocused(navigation.isFocused());
    const offFocus = navigation.addListener('focus', () => setFocused(true));
    const offBlur = navigation.addListener('blur', () => setFocused(false));
    return () => { offFocus(); offBlur(); };
  }, [navigation]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      setForeground(next === 'active');
    });
    return () => sub.remove();
  }, []);

  return focused && foreground;
}

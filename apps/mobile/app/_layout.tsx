import { useEffect } from 'react';
import { Stack, useRouter, useSegments, usePathname } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuth } from '../hooks/useAuth';
import { useProfileStore } from '../store/profileStore';
import { supabase } from '../lib/supabase';
import { DevPanel } from '../components/dev/DevPanel';
import { Analytics } from '../lib/analytics';
import { logError, setCrashlyticsUser } from '../lib/errorLogger';
import { ErrorBoundary } from '../components/ErrorBoundary';

export default function RootLayout() {
  const { user, loading } = useAuth();
  const { profile, setProfile } = useProfileStore();
  const router = useRouter();
  const segments = useSegments();
  const pathname = usePathname();

  useEffect(() => {
    Analytics.screenView(pathname);
  }, [pathname]);

  useEffect(() => {
    const previous = ErrorUtils.getGlobalHandler();
    ErrorUtils.setGlobalHandler((error, isFatal) => {
      logError(error, isFatal ? 'fatal_js_error' : 'unhandled_js_error');
      previous?.(error, isFatal);
    });
  }, []);

  useEffect(() => {
    Analytics.setUser(user?.id ?? null);
    setCrashlyticsUser(user?.id ?? null);
  }, [user?.id]);

  useEffect(() => {
    if (loading) return;

    const inAuth = segments[0] === '(auth)';

    if (!user && !inAuth) {
      router.replace('/(auth)/welcome');
      return;
    }

    if (user && inAuth) {
      // User just signed in — check if onboarding is complete
      void Promise.resolve(
        supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
      ).then(({ data, error }) => {
        if (error) { logError(error, 'layout_profile_fetch'); return; }
        if (!data) {
          router.replace('/(auth)/onboarding/step1-identity');
        } else {
          setProfile(data);
          router.replace('/(tabs)/grow');
        }
      }).catch((e: unknown) => logError(e, 'layout_profile_fetch'));
      return;
    }

    if (user && !inAuth && !profile) {
      // Already in tabs but profile not loaded — fetch it
      void Promise.resolve(
        supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
      ).then(({ data, error }) => {
        if (error) { logError(error, 'layout_profile_reload'); return; }
        if (data) setProfile(data);
        else router.replace('/(auth)/onboarding/step1-identity');
      }).catch((e: unknown) => logError(e, 'layout_profile_reload'));
    }
  }, [user, loading, segments]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <Stack screenOptions={{ headerShown: false }} />
        </ErrorBoundary>
        {__DEV__ && <DevPanel />}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

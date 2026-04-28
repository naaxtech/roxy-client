import { useEffect, useRef } from 'react';
import { Stack, useRouter, useSegments, usePathname } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StripeProvider } from '@stripe/stripe-react-native';
import { PostHogProvider, usePostHog } from 'posthog-react-native';
import { posthog } from '../lib/posthog';
import { useAuth } from '../hooks/useAuth';
import { useProfileStore } from '../store/profileStore';
import { supabase } from '../lib/supabase';
import { DevPanel } from '../components/dev/DevPanel';
import { Analytics } from '../lib/analytics';
import { logError, logBreadcrumb, setCrashlyticsUser } from '../lib/errorLogger';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { useThemeStore } from '../store/themeStore';


function AppNavigator() {
  const { user, loading } = useAuth();
  const { profile, setProfile } = useProfileStore();
  const router = useRouter();
  const segments = useSegments();
  const pathname = usePathname();
  const posthog = usePostHog();
  // Tracks which user ID has a profile fetch in flight — prevents concurrent
  // fetches that would issue conflicting router.replace() calls (flicker).
  const fetchingForUserRef = useRef<string | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    Analytics.screenView(pathname);
    posthog?.screen(pathname);
  }, [pathname]);

  useEffect(() => {
    const previous = ErrorUtils.getGlobalHandler();
    ErrorUtils.setGlobalHandler((error, isFatal) => {
      logError(error, isFatal ? 'fatal_js_error' : 'unhandled_js_error');
      previous?.(error, isFatal);
    });
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    Analytics.setUser(user?.id ?? null);
    setCrashlyticsUser(user?.id ?? null);
    if (user?.id) {
      posthog?.identify(user.id);
    } else {
      posthog?.reset();
    }
  }, [user?.id]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (loading) return;
    // segments is [] on the very first render before Expo Router initialises.
    // Acting on empty segments means inAuth/inOnboarding are both false —
    // triggering the profile-fetch block and redirecting mid-onboarding users
    // back to step1 on every navigation. Wait until the stack is ready.
    if (!segments.length) return;

    const inAuth = segments[0] === '(auth)';
    // Guard: while stepping through onboarding do NOT re-run the profile check.
    // useSegments() emits transient intermediate values during Stack push animations
    // (e.g. ['(auth)'] briefly before the child segment resolves). usePathname()
    // is computed differently and stays stable during transitions — use BOTH so
    // a transient segments state cannot incorrectly set inOnboarding=false.
    const inOnboarding =
      segments.some((s) => s === 'onboarding') || pathname.includes('/onboarding');

    if (!user && !inAuth) {
      router.replace('/(auth)/welcome');
      return;
    }

    if (user && inAuth && !inOnboarding) {
      // Prevent concurrent fetches for the same user from issuing conflicting
      // router.replace() calls (the other root cause of the flicker).
      if (fetchingForUserRef.current === user.id) return;
      fetchingForUserRef.current = user.id;
      void Promise.resolve(supabase.from('profiles').select('*').eq('id', user.id).maybeSingle())
        .then(({ data, error }) => {
          fetchingForUserRef.current = null;
          if (error) { logError(error, 'layout_profile_fetch'); return; }
          // Route to tabs only when onboarding is fully complete.
          if (!data || !data.onboarding_completed) {
            router.replace('/(auth)/onboarding/step1-identity');
          } else {
            setProfile(data);
            void useThemeStore.getState().init(data.theme_preference ?? null);
            router.replace('/(tabs)/grow');
          }
        }).catch((e: unknown) => {
          fetchingForUserRef.current = null;
          logError(e, 'layout_profile_fetch');
        });
      return;
    }

    // Also fire when profile is in store but onboarding was never completed —
    // prevents a partially-onboarded user from accessing the dashboard.
    if (user && !inAuth && (!profile || !profile.onboarding_completed)) {
      if (fetchingForUserRef.current === user.id) return;
      fetchingForUserRef.current = user.id;
      void Promise.resolve(supabase.from('profiles').select('*').eq('id', user.id).maybeSingle())
        .then(({ data, error }) => {
          fetchingForUserRef.current = null;
          if (error) { logError(error, 'layout_profile_reload'); return; }
          if (data?.onboarding_completed) {
            setProfile(data);
            void useThemeStore.getState().init(data.theme_preference ?? null);
          } else {
            logBreadcrumb('layout_redirect_incomplete_onboarding', { has_profile: String(!!data) });
            router.replace('/(auth)/onboarding/step1-identity');
          }
        }).catch((e: unknown) => {
          fetchingForUserRef.current = null;
          logError(e, 'layout_profile_reload');
        });
    }
  // user?.id (not user) — prevents re-firing on TOKEN_REFRESHED events where
  // Supabase creates a new user object reference with the same ID.
  // pathname added alongside segments: pathname is stable during Stack push
  // animations whereas segments can transiently drop child routes mid-transition.
  }, [user?.id, loading, segments, pathname]);

  const STRIPE_KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';

  const inner = (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <Stack screenOptions={{ headerShown: false }} />
        </ErrorBoundary>
        {__DEV__ && <DevPanel />}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );

  // StripeProvider crashes with an empty publishableKey — skip it when key is missing.
  // Add EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY to eas.json to enable payment features in builds.
  if (!STRIPE_KEY) return inner;

  return (
    <StripeProvider
      publishableKey={STRIPE_KEY}
      merchantIdentifier="merchant.app.roxy"
      urlScheme="roxy"
    >
      {inner}
    </StripeProvider>
  );
}

export default function RootLayout() {
  // posthog is null when EXPO_PUBLIC_POSTHOG_API_KEY is missing from the build env.
  // PostHogProvider requires a non-null client, so skip the wrapper when unavailable.
  if (!posthog) return <AppNavigator />;
  return (
    <PostHogProvider client={posthog}>
      <AppNavigator />
    </PostHogProvider>
  );
}

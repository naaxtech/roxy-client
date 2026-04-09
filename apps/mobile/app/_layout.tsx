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
import { logError, setCrashlyticsUser } from '../lib/errorLogger';
import { ErrorBoundary } from '../components/ErrorBoundary';


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

  useEffect(() => {
    Analytics.setUser(user?.id ?? null);
    setCrashlyticsUser(user?.id ?? null);
    if (user?.id) {
      posthog?.identify(user.id);
    } else {
      posthog?.reset();
    }
  }, [user?.id]);

  useEffect(() => {
    if (loading) return;

    const inAuth = segments[0] === '(auth)';
    // Guard: while stepping through onboarding do NOT re-run the profile check.
    // Each router.push changes segments, which re-fires this effect. Without the
    // guard the effect would see the newly-created partial profile and redirect
    // back to step1 — causing the flicker + ejection bug.
    const inOnboarding = segments[1] === 'onboarding';

    if (!user && !inAuth) {
      router.replace('/(auth)/welcome');
      return;
    }

    if (user && inAuth && !inOnboarding) {
      // Prevent concurrent fetches for the same user from issuing conflicting
      // router.replace() calls (the other root cause of the flicker).
      if (fetchingForUserRef.current === user.id) return;
      fetchingForUserRef.current = user.id;
      void supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
        .then(({ data, error }) => {
          fetchingForUserRef.current = null;
          if (error) { logError(error, 'layout_profile_fetch'); return; }
          // Route to tabs only when onboarding is fully complete.
          if (!data || !data.onboarding_completed) {
            router.replace('/(auth)/onboarding/step1-identity');
          } else {
            setProfile(data);
            router.replace('/(tabs)/grow');
          }
        }).catch((e: unknown) => {
          fetchingForUserRef.current = null;
          logError(e, 'layout_profile_fetch');
        });
      return;
    }

    if (user && !inAuth && !profile) {
      if (fetchingForUserRef.current === user.id) return;
      fetchingForUserRef.current = user.id;
      void supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
        .then(({ data, error }) => {
          fetchingForUserRef.current = null;
          if (error) { logError(error, 'layout_profile_reload'); return; }
          if (data) setProfile(data);
          else router.replace('/(auth)/onboarding/step1-identity');
        }).catch((e: unknown) => {
          fetchingForUserRef.current = null;
          logError(e, 'layout_profile_reload');
        });
    }
  // user?.id (not user) — prevents re-firing on TOKEN_REFRESHED events where
  // Supabase creates a new user object reference with the same ID.
  }, [user?.id, loading, segments]);

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

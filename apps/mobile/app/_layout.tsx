import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { Stack, useRouter, useSegments, usePathname } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StripeProvider } from '@stripe/stripe-react-native';
import { Audio } from 'expo-av';
import { PostHogProvider, usePostHog } from 'posthog-react-native';
import { posthog } from '../lib/posthog';
import { useAuth } from '../hooks/useAuth';
import { useProfileStore } from '../store/profileStore';
import { supabase } from '../lib/supabase';
import { DevPanel } from '../components/dev/DevPanel';
import { Analytics } from '../lib/analytics';
import { logError, logBreadcrumb, setCrashlyticsUser, hashUserId } from '../lib/errorLogger';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ReportSheet } from '../components/safety/ReportSheet';
import { useThemeStore } from '../store/themeStore';
import { THEMES } from '../lib/theme';
import { useAppFonts } from '../hooks/useAppFonts';
import { WebAppFrame } from '../components/ui/WebAppFrame';
import { shouldRedirectToPending, shouldRedirectToApplication } from '../lib/authRouting';
import { useGateStore } from '../store/gateStore';


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
  // Outfit + Figtree. `ready` also goes true on failure — see useAppFonts.
  const { ready: fontsReady } = useAppFonts();
  const themeName = useThemeStore((s) => s.theme);

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

    // Reels audio is silent on an iPhone whose ring switch is flipped without
    // this: expo-av defaults playsInSilentModeIOS to false, so unmuting a video
    // plays nothing. staysActiveInBackground stays false — a social feed has no
    // business holding the audio session once the app is backgrounded.
    // Never at module scope: it touches the native audio session.
    // src: https://github.com/expo/expo/blob/sdk-51/packages/expo-av/src/Audio.ts · expo-av 14.0.7 · 2026-08-02
    void Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
    }).catch((e: unknown) => logError(e, 'layout_audio_mode'));
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    Analytics.setUser(user?.id ?? null);
    setCrashlyticsUser(user?.id ?? null);
    if (user?.id) {
      posthog?.identify(hashUserId(user.id));
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
      // The code gate, not welcome. Roxy is invite-only: an account cannot be
      // created without a code a community issued, so code entry is the first
      // screen and sign-in is reached from it.
      router.replace('/(auth)/code');
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
          // The gate outranks onboarding. An applicant awaiting a decision can
          // read nothing (RLS denies it), so walking her through identity and
          // interests would collect data against an account that may never
          // exist. She waits, and completes onboarding once a human says yes.
          // Exempts /(auth)/application, which an applicant must be able to open
          // while 'pending' — see shouldRedirectToPending.
          if (shouldRedirectToPending(data?.vetting_status, segments, pathname)) {
            router.replace('/(auth)/pending');
            return;
          }
          // A held code outranks onboarding for the same reason the gate does.
          // OAuth signs up through a redirect, so the code is still unredeemed
          // when we land here and only loadApplication() on the application
          // screen can redeem it — see shouldRedirectToApplication.
          if (shouldRedirectToApplication(
            !!data,
            useGateStore.getState().validatedCode !== null,
            segments,
            pathname,
          )) {
            router.replace('/(auth)/application');
            return;
          }
          // Route to tabs only when onboarding is fully complete.
          if (!data || !data.onboarding_completed) {
            router.replace('/(auth)/onboarding/step1-identity');
          } else {
            setProfile(data);
            void useThemeStore.getState().init(data.theme_preference ?? null);
            // The feed is the front door in 3.0. Grow was a dashboard you read;
            // the feed is something to be in, and landing in it is the whole
            // point of flattening the IA.
            router.replace('/(tabs)/feed');
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
          // Same precedence as above: a decision that lands while the app is
          // open (or an account rejected after admission) pulls the user out of
          // the tabs rather than leaving her on a screen RLS has emptied.
          if (shouldRedirectToPending(data?.vetting_status, segments, pathname)) {
            router.replace('/(auth)/pending');
            return;
          }
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

  // Every hook above this line runs unconditionally. Holding the tree for a
  // frame or two while the two families register avoids the flash of a
  // system-font first paint reflowing into Figtree; the ground is painted in
  // the active theme so the hold reads as the app, not as a white gap.
  if (!fontsReady) {
    return <View style={{ flex: 1, backgroundColor: THEMES[themeName].background }} />;
  }

  const inner = (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <WebAppFrame>
          <ErrorBoundary>
            <Stack screenOptions={{ headerShown: false }} />
            {/* Mounted once, at the root, so every surface that calls
                safetyStore.openReportModal actually opens something. Before
                this, nothing in the app read isReportModalOpen — the Report
                button on a live audio room and on a video date with a stranger
                did nothing at all. Chat kept working only because it carries
                its own local modal. */}
            <ReportSheet />
          </ErrorBoundary>
        </WebAppFrame>
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

import { useEffect } from 'react';
import { View } from 'react-native';
import { usePathname } from 'expo-router';
import { TransitionStack } from '../components/motion/TransitionStack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StripeProvider } from '@stripe/stripe-react-native';
import { Audio } from 'expo-av';
import { PostHogProvider, usePostHog } from 'posthog-react-native';
import { posthog } from '../lib/posthog';
import { useAuth } from '../hooks/useAuth';
import { DevPanel } from '../components/dev/DevPanel';
import { BadgeCelebration } from '../components/gamification/BadgeCelebration';
import { FirstPostCelebrationHost } from '../components/feed/FirstPostCelebration';
import { useCelebrationStore } from '../store/celebrationStore';
import { Analytics } from '../lib/analytics';
import { logError, setCrashlyticsUser, hashUserId } from '../lib/errorLogger';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ReportSheet } from '../components/safety/ReportSheet';
import { SnackbarHost } from '../components/feedback/SnackbarHost';
import { useThemeStore } from '../store/themeStore';
import { THEMES } from '../lib/theme';
import { useAppFonts } from '../hooks/useAppFonts';
import { WebAppFrame } from '../components/ui/WebAppFrame';
import { LaunchGate } from '../components/features/FeatureGate';
import { applyBrandType } from '../lib/applyBrandType';
import { useWelcomeInRedirect } from '../hooks/useWelcomeInRedirect';
import { useRootRedirect, type RootRedirectAuth } from '../hooks/useRootRedirect';

applyBrandType();

/** Created once: a new object per render re-derived every root descriptor. */
const ROOT_STACK_OPTIONS = { headerShown: false } as const;


/**
 * Every root-level redirect, in a component of its own.
 *
 * Both hooks wait for the root navigator (useRootNavigatorReady): a
 * router.replace before it mounts throws "Attempted to navigate before
 * mounting the Root Layout component", and AppNavigator holds its navigator
 * back until the fonts load. That was the blank page on every signed-out deep
 * link (b2e54f94).
 *
 * A component rather than two calls in AppNavigator because readiness
 * subscribes to the root navigation state, which changes on every navigation;
 * here a change re-renders a component that draws nothing, instead of the
 * whole app shell. AppNavigator renders it first in every branch, so the hold
 * → app switch never remounts it (its refs hold the in-flight fetch and the
 * deep link's return-to).
 */
function RootRedirects({ auth }: { auth: RootRedirectAuth }) {
  useRootRedirect(auth);
  // G-11: a just-approved member is greeted once with "You're in" — on a cold
  // start after approval, or the moment the live sync flips her profile.
  useWelcomeInRedirect();
  return null;
}

function AppNavigator() {
  const { user, loading, signOut } = useAuth();
  const pathname = usePathname();
  const posthog = usePostHog();
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

  const STRIPE_KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';

  // First in every branch below, so it keeps its place in the tree.
  const redirects = <RootRedirects auth={{ user, loading, signOut }} />;

  // Every hook above this line runs unconditionally. Holding the tree for a
  // frame or two while the two families register avoids the flash of a
  // system-font first paint reflowing into Figtree; the ground is painted in
  // the active theme so the hold reads as the app, not as a white gap.
  // The hold has no navigator in it, so nothing may navigate during it: the
  // redirects wait for useRootNavigatorReady. Mounting the navigator under a
  // cover instead would render every screen in the system face, and native
  // Text that mounted before the font registered keeps the fallback.
  if (!fontsReady) {
    return (
      <>
        {redirects}
        <View style={{ flex: 1, backgroundColor: THEMES[themeName].background }} />
      </>
    );
  }

  const inner = (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <WebAppFrame>
          <ErrorBoundary>
            <LaunchGate>
              {/* The platform push on native, explicit; push/pop/modal
                  transitions on the web (TransitionStack, motion spec §3.1
                  row 5). A bare expo-router Stack jump-cut on roxy.expo.app. */}
              <TransitionStack screenOptions={ROOT_STACK_OPTIONS} />
            </LaunchGate>
            {/* Mounted once, at the root, so every surface that calls
                safetyStore.openReportModal actually opens something. Before
                this, nothing in the app read isReportModalOpen — the Report
                button on a live audio room and on a video date with a stranger
                did nothing at all. Chat kept working only because it carries
                its own local modal. */}
            <ReportSheet />
            {/* The one snackbar (lane C0's SnackbarHost): any screen calls
                snackbar.show(); it sits above the nav bar and the Roxy
                button's lane, inside the app frame. */}
            <SnackbarHost />
          </ErrorBoundary>
        </WebAppFrame>
        {__DEV__ && <DevPanel />}
        <BadgeCelebrationHost />
        <FirstPostCelebrationHost />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );

  // StripeProvider crashes with an empty publishableKey — skip it when key is missing.
  // Add EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY to eas.json to enable payment features in builds.
  if (!STRIPE_KEY) {
    return (
      <>
        {redirects}
        {inner}
      </>
    );
  }

  return (
    <>
      {redirects}
      <StripeProvider
        publishableKey={STRIPE_KEY}
        merchantIdentifier="merchant.app.roxy"
        urlScheme="roxy"
      >
        {inner}
      </StripeProvider>
    </>
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

/**
 * Mounted once, at the root.
 *
 * A badge can be earned anywhere — `syncMyBadges` runs on the badges screen
 * today and after a vote or an RSVP tomorrow — so the celebration lives above
 * all of them rather than on the screen that happened to trigger it. No future
 * caller has to remember to render it.
 */
function BadgeCelebrationHost() {
  const pending = useCelebrationStore((s) => s.pending);
  const dismiss = useCelebrationStore((s) => s.dismiss);
  if (pending.length === 0) return null;
  return <BadgeCelebration badges={pending} onDismiss={dismiss} />;
}

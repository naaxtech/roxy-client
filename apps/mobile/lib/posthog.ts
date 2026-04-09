import PostHog from 'posthog-react-native';

const API_KEY = process.env.EXPO_PUBLIC_POSTHOG_API_KEY ?? '';
const HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com';

export const posthog = new PostHog(API_KEY, {
  host: HOST,

  // Session replay — records the screen so you can watch what users do.
  // Must also be enabled in PostHog dashboard: Project Settings → Session Replay.
  // Requires a dev/production build (not Expo Go).
  enableSessionReplay: true,
  sessionReplayConfig: {
    maskAllTextInputs: true,   // hides passwords and sensitive fields
    maskAllImages: false,      // avatars/covers are fine to show
    captureLog: true,          // console logs appear in replay timeline
  },

  // Error tracking — automatically captures uncaught JS exceptions and
  // unhandled promise rejections. Caught errors go through logError() below.
  errorTracking: {
    autocapture: {
      uncaughtExceptions: true,
      unhandledRejections: true,
    },
  },

  // Lifecycle events (app open, background, etc.) captured automatically.
  captureAppLifecycleEvents: true,
});

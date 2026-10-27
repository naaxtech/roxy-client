import { useEffect, useRef } from 'react';
import { useRouter, useSegments, usePathname } from 'expo-router';
import { useProfileStore } from '../store/profileStore';
import { supabase } from '../lib/supabase';
import { logError, logBreadcrumb } from '../lib/errorLogger';
import { useThemeStore } from '../store/themeStore';
import {
  decideRootRoute,
  decideAfterProfileFetch,
  ONBOARDING_START_HREF,
} from '../lib/authRouting';
import { showAlert } from '../lib/confirm';
import { storedProfileIsForUser } from '../lib/signupSession';
import { effectiveVettingStatus, resolveAccountKind } from '../lib/features';
import { useViewAsStore } from '../store/viewAsStore';
import { useGateStore } from '../store/gateStore';
import { useRootNavigatorReady } from './useRootNavigatorReady';
import type { Profile } from '../types';

/** A my_profile row: the Profile the store holds, plus the column the theme reads. */
type ProfileRow = Profile & { theme_preference?: string | null };

/** The parts of useAuth() the redirect needs. The root layout owns useAuth(). */
export interface RootRedirectAuth {
  user: { id: string } | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

/**
 * The root layout's auth redirect: who may be where, applied with
 * router.replace. Every decision is lib/authRouting's (decideRootRoute, then
 * decideAfterProfileFetch once her profile is in hand); this hook only reads
 * the inputs, fetches the profile and applies the answer.
 *
 * It moved out of app/_layout.tsx so it can be tested as rendered — the two
 * login bugs it fixes were both invisible to a suite that could not reach it:
 * a redirect fired before the root navigator mounted (blank page on any
 * signed-out deep link), and a signed-in member was left on the applicant code
 * screen after pressing Back.
 */
export function useRootRedirect({ user, loading, signOut }: RootRedirectAuth): void {
  const { profile, setProfile } = useProfileStore();
  const router = useRouter();
  const segments = useSegments();
  const pathname = usePathname();
  const navigatorReady = useRootNavigatorReady();
  const viewAsPreview = useViewAsStore((s) => s.preview);
  // Tracks which user ID has a profile fetch in flight — prevents concurrent
  // fetches that would issue conflicting router.replace() calls (flicker).
  const fetchingForUserRef = useRef<string | null>(null);
  // The page a signed-out deep link asked for; she lands there after signing
  // in. In memory: an OAuth redirect reloads the page and falls back to the
  // feed, which is where she would have gone anyway.
  const returnToRef = useRef<string | null>(null);
  // Once a session has existed in this launch, a signed-out redirect is a
  // sign-out, and the page she signed out from is not somewhere to return to.
  const hadSessionRef = useRef(false);

  const signOutDeleted = async () => {
    await signOut();
    showAlert(
      'This account is being deleted',
      'You asked us to delete it, so it can no longer sign in. If that was a mistake, write to support@roxyhq.com within 30 days.',
    );
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (user) hadSessionRef.current = true;

    // A leftover profile from the previous login must not decide routing.
    // Sign-out used to leave themjuicypeach in memory; the next signup then
    // treated that completed core profile as this session.
    const liveProfile = storedProfileIsForUser(profile?.id, user?.id) ? profile : null;
    if (!loading && profile && !liveProfile) setProfile(null);

    const decision = decideRootRoute({
      navigatorReady,
      authLoading: loading,
      signedIn: !!user,
      hadSession: hadSessionRef.current,
      segments,
      pathname,
      liveProfile,
    });

    if (decision.kind === 'wait' || decision.kind === 'stay') return;

    if (decision.kind === 'redirect') {
      // The latest signed-out deep link wins; a sign-out (null) clears it.
      returnToRef.current = decision.returnTo;
      router.replace(decision.href as never);
      return;
    }

    if (!user) return;
    const { origin } = decision;
    const tag = origin === 'auth' ? 'layout_profile_fetch' : 'layout_profile_reload';
    // Prevent concurrent fetches for the same user from issuing conflicting
    // router.replace() calls (the other root cause of the flicker).
    if (fetchingForUserRef.current === user.id) return;
    fetchingForUserRef.current = user.id;
    void Promise.resolve(supabase.from('my_profile').select('*').eq('id', user.id).maybeSingle())
      .then(({ data, error }) => {
        fetchingForUserRef.current = null;
        if (error) { logError(error, tag); return; }
        const row = (data as ProfileRow | null) ?? null;
        // The return-to is used only by an auth-screen decision, and spent by
        // the first signed-in decision of either kind: a new account goes on
        // to its application or onboarding, and one who signed in another
        // way (a password reset lands inside the app) must not have a stale
        // return-to ambush her on a later trip through an auth screen.
        const returnTo = origin === 'auth' ? returnToRef.current : null;
        returnToRef.current = null;

        const next = decideAfterProfileFetch({
          origin,
          profile: row,
          vettingStatus: effectiveVettingStatus(
            row?.vetting_status,
            resolveAccountKind(row) === 'core' ? useViewAsStore.getState().preview : null,
          ),
          hasValidatedCode: useGateStore.getState().validatedCode !== null,
          segments,
          pathname,
          returnTo,
        });

        if (next.kind === 'stay') return;
        if (next.kind === 'sign-out-deleted') {
          // G-16: she is signed out and told why, never dropped into an
          // emptied shell.
          logBreadcrumb(`${tag}_deleted_account`);
          void signOutDeleted();
          return;
        }
        if (row && (next.kind === 'admit' || next.admit)) {
          setProfile(row);
          void useThemeStore.getState().init(row.theme_preference ?? null);
        }
        if (next.kind === 'admit') return;
        if (origin === 'app' && next.href === ONBOARDING_START_HREF) {
          logBreadcrumb('layout_redirect_incomplete_onboarding', { has_profile: String(!!row) });
        }
        router.replace(next.href as never);
      }).catch((e: unknown) => {
        fetchingForUserRef.current = null;
        logError(e, tag);
      });
  // user?.id (not user) — prevents re-firing on TOKEN_REFRESHED events where
  // Supabase creates a new user object reference with the same ID.
  // pathname added alongside segments: pathname is stable during Stack push
  // animations whereas segments can transiently drop child routes mid-transition.
  // navigatorReady: the redirect that was held while no navigator existed runs
  // the moment one mounts.
  }, [user?.id, loading, segments, pathname, viewAsPreview, navigatorReady]);
}

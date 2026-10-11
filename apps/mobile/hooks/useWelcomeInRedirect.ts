import { useEffect, useRef } from 'react';
import { useRouter, useSegments, usePathname } from 'expo-router';
import { useAuthStore } from '../store/authStore';
import { useProfileStore } from '../store/profileStore';
import { useViewAsStore } from '../store/viewAsStore';
import { canGreetNewMemberHere } from '../lib/authRouting';
import { shouldGreetNewMember } from '../lib/welcomeIn';

/**
 * Sends a just-approved member to "You're in" exactly once (G-11).
 *
 * Mounted at the root so both paths arrive here: approved while the app was
 * closed (the layout's profile fetch lands her in the tabs), or approved while
 * she waited inside it (useVettingStatusSync flips the profile in the store).
 * The "once" lives in lib/welcomeIn (a per-user seen flag on this device); this
 * hook only decides WHEN it is safe to ask, and asks at most once per user and
 * status so ordinary navigation never re-queries.
 */
export function useWelcomeInRedirect(): void {
  const router = useRouter();
  const segments = useSegments();
  const pathname = usePathname();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const vetting = useProfileStore((s) => s.profile?.vetting_status ?? null);
  const onboarded = useProfileStore((s) => s.profile?.onboarding_completed === true);
  const preview = useViewAsStore((s) => s.preview);
  const askedFor = useRef<string | null>(null);

  const eligibleHere = canGreetNewMemberHere(vetting, onboarded, segments, pathname);

  useEffect(() => {
    if (!userId || preview || !eligibleHere) return;
    const key = `${userId}:${vetting}`;
    if (askedFor.current === key) return;
    askedFor.current = key;
    let cancelled = false;
    void shouldGreetNewMember(userId).then((due) => {
      if (!cancelled && due) router.replace('/(auth)/welcome-in');
    });
    return () => { cancelled = true; };
  }, [userId, vetting, preview, eligibleHere, router]);
}

import { useRouter } from 'expo-router';
import { Snackbar } from '../ui/Snackbar';
import { SNACKBAR_HOST_BOTTOM } from '../feedback';
import type { EarnedBadgeCard } from '../../lib/badges';

interface Props {
  badges: EarnedBadgeCard[];
  onDismiss: () => void;
  testID?: string;
}

/**
 * The moment a badge is earned: a quiet snackbar (decision P6, 2026-10-23).
 *
 * Roxy once awarded badges silently — `sync_my_badges` returned a count
 * nobody rendered — which is no reward at all, so this still names what she
 * earned ("You earned First friend 🤝", or a count when several land
 * together) and offers View, which opens her badges. It no longer takes the
 * screen: no Modal, no scrim, no confetti, no pop and no haptic (motion spec
 * §3.3 keeps buzzes for the mapped events). It sits above the nav bar and the
 * Roxy button's lane and leaves on its own after the snackbar time.
 *
 * The previous full-screen overlay (confetti, card, "Next" per badge) is in
 * git history: `git log -S "BADGE EARNED" -- components/gamification/BadgeCelebration.tsx`.
 * `Confetti` stays in use by FirstPostCelebration.
 */
export function BadgeCelebration({ badges, onDismiss, testID = 'badge-celebration' }: Props) {
  const router = useRouter();
  if (badges.length === 0) return null;
  const first = badges[0];
  const message = badges.length === 1
    ? `You earned ${first.name} ${first.emoji}`.trim()
    : `You earned ${badges.length} badges`;
  return (
    <Snackbar
      visible
      message={message}
      actionLabel="View"
      onAction={() => router.push('/badges' as never)}
      onDismiss={onDismiss}
      bottom={SNACKBAR_HOST_BOTTOM}
      testID={testID}
    />
  );
}
